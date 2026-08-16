import { authHeaders, requestJson } from "./providers.js";
import { usesWebSearch, usesXSearch } from "./config.js";
import { getLocalTimeContext, platformPrompt } from "./context.js";
import { searchPrompt, xSearchPrompt } from "./prompts.js";
import { isXUrl, normalizeSourceUrl, parseXPostUrl } from "./sources.js";
import { numericField, usageDiagnostics } from "./usage.js";

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function textField(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function responsesEndpoint(config) {
  return `${config.grokApiUrl.replace(/\/+$/, "")}/responses`;
}

function inputMessages(query, options) {
  const messages = [{ role: "system", content: searchPrompt }];
  // Appended rather than merged so the base prompt remains a stable cache prefix.
  if (usesXSearch(options.searchSource)) messages.push({ role: "system", content: xSearchPrompt });
  messages.push({ role: "user", content: getLocalTimeContext() + query + platformPrompt(options.platform) });
  return messages;
}

function directWebSearchTool(options) {
  const tool = { type: "web_search" };
  const filters = {};
  if (options.allowedDomains.length) filters.allowed_domains = options.allowedDomains;
  if (options.excludedDomains.length) filters.excluded_domains = options.excludedDomains;
  if (Object.keys(filters).length) tool.filters = filters;
  return tool;
}

function xSearchFilters(options) {
  const filters = {};
  if (options.allowedXHandles.length) filters.allowed_x_handles = options.allowedXHandles;
  if (options.excludedXHandles.length) filters.excluded_x_handles = options.excludedXHandles;
  if (options.xFromDate) filters.from_date = options.xFromDate;
  if (options.xToDate) filters.to_date = options.xToDate;
  if (options.xImageUnderstanding) filters.enable_image_understanding = true;
  if (options.xVideoUnderstanding) filters.enable_video_understanding = true;
  return filters;
}

function buildDirectResponsesBody(query, options) {
  const tools = [];
  if (usesWebSearch(options.searchSource)) tools.push(directWebSearchTool(options));
  if (usesXSearch(options.searchSource)) tools.push({ type: "x_search", ...xSearchFilters(options) });
  // Mounting no tool at all silently turns a search into a from-memory answer, so treat
  // an unrecognized source as a programming error rather than shipping an empty request.
  if (!tools.length) {
    const error = new Error(`未知的 search source: ${JSON.stringify(options.searchSource)}`);
    error.code = "SEARCH_SOURCE_INVALID";
    throw error;
  }

  const body = {
    model: options.model,
    input: inputMessages(query, options),
    tools,
    max_turns: options.maxTurns,
    stream: false,
  };

  const fixedReasoning420 = /^grok-4\.20(?!.*multi-agent)/i.test(options.model);
  if (options.reasoningEffort && !/non-reasoning/i.test(options.model) && !fixedReasoning420) {
    body.reasoning = {
      effort: options.reasoningEffort,
      summary: "concise",
    };
  }

  return body;
}

function buildOpenRouterResponsesBody(query, options) {
  const parameters = {
    engine: options.openRouterEngine,
    max_results: 5,
    max_total_results: 10,
  };
  if (options.allowedDomains.length) parameters.allowed_domains = options.allowedDomains;
  if (options.excludedDomains.length) parameters.excluded_domains = options.excludedDomains;

  const body = {
    model: options.model,
    input: inputMessages(query, options),
    tools: [{ type: "openrouter:web_search", parameters }],
    stream: false,
  };

  // OpenRouter attaches x_search to native search on its own for xAI models; the only
  // control it exposes is this top-level filter, so "x"/"web" cannot be enforced here.
  if (usesXSearch(options.searchSource)) body.x_search_filter = xSearchFilters(options);

  return body;
}

export function buildResponsesBody(query, options, config) {
  if (config.apiProvider === "openrouter") return buildOpenRouterResponsesBody(query, options);
  return buildDirectResponsesBody(query, options);
}

function outputItems(data) {
  return Array.isArray(data?.output) ? data.output : [];
}

function contentItems(item) {
  const content = item?.content ?? item?.message?.content ?? item?.output?.content;
  return asArray(content);
}

function outputTextFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!isPlainObject(content)) return "";
  if (["output_text", "text", "message_text"].includes(content.type) && typeof content.text === "string") {
    return content.text.trim();
  }
  if (typeof content.text === "string") return content.text.trim();
  if (typeof content.content === "string") return content.content.trim();
  return "";
}

function extractResponsesText(data) {
  const directText = textField(data?.output_text);
  if (directText) return directText;

  const texts = [];
  for (const item of outputItems(data)) {
    if (item?.type && item.type !== "message" && !item.message && !item.content) continue;
    for (const content of contentItems(item)) {
      const text = outputTextFromContent(content);
      if (text) texts.push(text);
    }
  }

  if (!texts.length && Array.isArray(data?.choices)) {
    for (const choice of data.choices) {
      const text = textField(choice?.message?.content) || textField(choice?.text);
      if (text) texts.push(text);
    }
  }

  return texts.join("\n\n").trim();
}

function collectAnnotations(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectAnnotations(item, out);
    return out;
  }

  if (!isPlainObject(value)) return out;
  if (Array.isArray(value.annotations)) out.push(...value.annotations);

  for (const [key, nested] of Object.entries(value)) {
    if (key === "annotations") continue;
    if (nested && typeof nested === "object") collectAnnotations(nested, out);
  }

  return out;
}

function urlFromObject(value) {
  if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
  if (!isPlainObject(value)) return "";
  return (
    textField(value.url) ||
    textField(value.href) ||
    textField(value.link) ||
    textField(value.uri) ||
    textField(value?.source?.url) ||
    textField(value?.citation?.url) ||
    textField(value?.url_citation?.url)
  );
}

function titleFromObject(value) {
  if (!isPlainObject(value)) return "";
  return (
    textField(value.title) ||
    textField(value.name) ||
    textField(value.label) ||
    textField(value?.source?.title) ||
    textField(value?.citation?.title) ||
    textField(value?.url_citation?.title)
  );
}

function snippetFromObject(value) {
  if (!isPlainObject(value)) return "";
  return (
    textField(value.snippet) ||
    textField(value.description) ||
    textField(value.content) ||
    textField(value.text) ||
    textField(value.summary) ||
    textField(value?.source?.snippet) ||
    textField(value?.citation?.snippet) ||
    textField(value?.url_citation?.snippet)
  );
}

/**
 * X citations arrive as a bare URL whose title is only the inline citation marker
 * ("1", "2", ...). Recover the handle from the URL and drop the marker so the card
 * carries attribution instead of a meaningless number.
 */
function xSourceFields(url, title) {
  const post = parseXPostUrl(url);
  if (!post) return null;
  const isMarker = !title || /^\[?\d+\]?$/.test(title);
  if (!isMarker) return { ...post, title };
  return { ...post, ...(post.x_handle ? { title: `@${post.x_handle}` } : {}) };
}

function sourceFromValue(value, { sourceType, tool }) {
  const url = urlFromObject(value);
  if (!url) return null;
  const title = titleFromObject(value);
  const normalizedUrl = normalizeSourceUrl(url);
  const xFields = xSourceFields(normalizedUrl, title);

  return {
    provider: "grok-responses",
    source_type: sourceType,
    tool,
    url: normalizedUrl,
    ...(xFields ? xFields : title ? { title } : {}),
    ...(snippetFromObject(value) ? { snippet: snippetFromObject(value) } : {}),
  };
}

function citationTool(value, defaultTool, xEnabled) {
  // Citations are not tagged with the tool that produced them. When x_search is mounted
  // an X link almost certainly came from it; when it is not, web search indexes x.com
  // pages too, so claiming x_search there would report a search that never ran.
  if (xEnabled && isXUrl(urlFromObject(value))) return "x_search";
  return defaultTool;
}

function toolFromCall(item, defaultTool) {
  const raw = textField(item?.tool) || textField(item?.name) || textField(item?.type) || defaultTool;
  if (raw.endsWith("_call")) return raw.slice(0, -"_call".length);
  return raw;
}

function sourceArraysFromToolCall(item) {
  return [
    item?.action?.sources,
    item?.action?.results,
    item?.action?.search_results,
    item?.action?.web_results,
    item?.sources,
    item?.results,
    item?.search_results,
    item?.output?.sources,
    item?.output?.results,
  ].filter(Array.isArray);
}

function isSearchToolCall(item) {
  const type = textField(item?.type);
  const name = textField(item?.name) || textField(item?.tool);
  return /search/i.test(type) || /search/i.test(name);
}

function extractSearchedSources(data, defaultTool) {
  const sources = [];
  const toolCalls = [];
  let webSearchCalls = 0;
  let xSearchCalls = 0;

  for (const item of outputItems(data)) {
    if (!isSearchToolCall(item)) continue;
    const tool = toolFromCall(item, defaultTool);
    if (tool.includes("x_search")) xSearchCalls += 1;
    else if (tool.includes("web_search") || tool.includes("openrouter:web_search")) webSearchCalls += 1;

    let sourceCount = 0;
    for (const sourceArray of sourceArraysFromToolCall(item)) {
      for (const value of sourceArray) {
        const source = sourceFromValue(value, { sourceType: "searched", tool });
        if (!source) continue;
        sources.push(source);
        sourceCount += 1;
      }
    }

    toolCalls.push({
      tool,
      ...(textField(item?.type) ? { type: textField(item.type) } : {}),
      ...(textField(item?.status) ? { status: textField(item.status) } : {}),
      ...(textField(item?.action?.type) ? { action_type: textField(item.action.type) } : {}),
      ...(textField(item?.action?.query) ? { query: textField(item.action.query) } : {}),
      ...(textField(item?.action?.url) ? { url: textField(item.action.url) } : {}),
      source_count: sourceCount,
    });
  }

  return { sources, toolCalls, webSearchCalls, xSearchCalls };
}

function extractCitationSources(data, defaultTool, xEnabled) {
  const sources = [];
  for (const annotation of collectAnnotations(data)) {
    const tool = citationTool(annotation, defaultTool, xEnabled);
    const source = sourceFromValue(annotation, { sourceType: "citation", tool });
    if (source) sources.push(source);
  }

  for (const citation of asArray(data?.citations)) {
    const tool = citationTool(citation, defaultTool, xEnabled);
    const source = sourceFromValue(citation, { sourceType: "citation", tool });
    if (source) sources.push(source);
  }

  return sources;
}

function dedupeResponsesSources(citationSources, searchedSources) {
  const out = [];
  const indexByUrl = new Map();

  for (const source of [...citationSources, ...searchedSources]) {
    const key = normalizeSourceUrl(source.url);
    const existingIndex = indexByUrl.get(key);
    if (existingIndex == null) {
      indexByUrl.set(key, out.length);
      out.push(source);
      continue;
    }

    const existing = out[existingIndex];
    if (existing.source_type !== "citation" && source.source_type === "citation") {
      out[existingIndex] = { ...existing, ...source };
      continue;
    }

    if (!existing.title && source.title) existing.title = source.title;
    if (!existing.snippet && source.snippet) existing.snippet = source.snippet;
  }

  return out;
}

/**
 * Billing-grade tool counts. Some relays bill server-side tool calls without emitting
 * the matching `*_call` items in `output[]`, so `usage` carries counts the output array
 * misses. Others do the reverse and report the field zeroed out, so take whichever
 * source saw more calls per tool rather than letting either one alone win.
 */
function usageToolCounts(data) {
  const details = data?.usage?.server_side_tool_usage_details;
  if (!isPlainObject(details)) return null;
  const webSearchCalls = numericField(details.web_search_calls);
  const xSearchCalls = numericField(details.x_search_calls);
  if (webSearchCalls == null && xSearchCalls == null) return null;
  return { webSearchCalls: webSearchCalls ?? 0, xSearchCalls: xSearchCalls ?? 0 };
}

export function parseGrokResponses(data, { defaultTool = "web_search", xEnabled = false } = {}) {
  const warnings = [];
  const text = extractResponsesText(data);
  if (!text) warnings.push("Responses returned no output text.");
  if (!outputItems(data).length && !textField(data?.output_text)) warnings.push("Responses output array is missing or empty.");

  const citationSources = extractCitationSources(data, defaultTool, xEnabled);
  const searched = extractSearchedSources(data, defaultTool);
  const sources = dedupeResponsesSources(citationSources, searched.sources);
  const usageCounts = usageToolCounts(data);
  const counts = {
    webSearchCalls: Math.max(usageCounts?.webSearchCalls ?? 0, searched.webSearchCalls),
    xSearchCalls: Math.max(usageCounts?.xSearchCalls ?? 0, searched.xSearchCalls),
  };

  return {
    text,
    sources,
    diagnostics: {
      ...usageDiagnostics(data),
      responses_web_search_calls: counts.webSearchCalls,
      responses_x_search_calls: counts.xSearchCalls,
      responses_tool_calls: searched.toolCalls,
      responses_tool_call_total: counts.webSearchCalls + counts.xSearchCalls,
      warnings,
    },
  };
}

export async function searchGrokResponses(query, options, config) {
  const endpoint = responsesEndpoint(config);
  const body = buildResponsesBody(query, options, config);
  const data = await requestJson(endpoint, {
    headers: authHeaders(config.grokApiKey),
    body,
    timeoutMs: 180_000,
    config,
    retry: true,
    retryOnTimeout: false,
  });

  const defaultTool =
    config.apiProvider === "openrouter" ? "openrouter:web_search" : options.searchSource === "x" ? "x_search" : "web_search";
  // OpenRouter attaches x_search to native search for xAI models whatever we asked for.
  const xEnabled = usesXSearch(options.searchSource) || config.apiProvider === "openrouter";
  const parsed = parseGrokResponses(data, { defaultTool, xEnabled });
  if (!parsed.text.trim()) {
    const error = new Error("Grok Responses 返回空内容");
    error.code = "GROK_RESPONSES_EMPTY";
    error.diagnostics = parsed.diagnostics;
    throw error;
  }

  return {
    model: options.model,
    content: parsed.text,
    sources: parsed.sources,
    endpoint: "responses",
    diagnostics: parsed.diagnostics,
    raw: data,
  };
}
