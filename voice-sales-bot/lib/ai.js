/**
 * AI provider layer: real HTTP calls to Google Gemini or OpenAI.
 *
 * There is no simulated/offline response path anywhere in this module. If the
 * provider is not configured or the request fails, a typed AIError is thrown and
 * surfaced to the UI with the real reason.
 */
import { AIError } from './errors.js';
import { normalizeStatus, SALES_STATUSES } from './validation.js';
import { productKnowledge } from './products.js';

const MAX_TRANSCRIPT_CHARS = 14000;
const MAX_HISTORY_MESSAGES = 30;

const LANGUAGE_NAMES = {
  en: 'English',
  hi: 'Hindi (Devanagari script)',
};

export function buildSystemPrompt({ product, language }) {
  const languageName = LANGUAGE_NAMES[language] || 'English';
  return `You are Voxly, a warm, concise and consultative AI sales representative for ${product.name}.
You are speaking with a prospective customer on a live voice call. Your speech is transcribed, so answers must sound natural when spoken aloud.

LANGUAGE RULES
- Conduct the entire conversation in ${languageName}.
- If the customer writes or speaks the other supported language, mirror their language for that turn.
- Keep replies to 1-3 short sentences (under 55 words). This is a phone call, not an email.

GROUNDING RULES (critical)
- The PRODUCT KNOWLEDGE below is the only approved source of truth.
- Never invent features, prices, discounts, customer names, certifications, integrations or timelines.
- If the customer asks something not covered below, say you will confirm it with the team and offer to arrange a follow-up or demo. Do not guess.
- Never promise a discount, contract term or legal commitment that is not listed.
- You may mention that pricing is per user/month exactly as listed.

SALES BEHAVIOUR
- Open by thanking them for their time and asking one qualifying question about their team and current process.
- Answer the question asked first, then ask at most one follow-up question.
- Handle objections with the approved answers; stay honest if you do not know something.
- Look for buying signals and move toward a clear next step: start the free trial listed in the knowledge base, book a demo, or agree a follow-up call.
- Never pressure, never fabricate urgency, and never claim to be human. If asked, say you are an AI sales assistant.

PRODUCT KNOWLEDGE
${productKnowledge(product)}`;
}

function transcriptToContents(messages) {
  return messages
    .filter((m) => m.role === 'customer' || m.role === 'assistant')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
}

function clipTranscript(messages) {
  let text = messages
    .map((m) => `${m.role === 'assistant' ? 'AGENT' : 'CUSTOMER'}: ${m.content}`)
    .join('\n');
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    text = `[Earlier part of the conversation omitted]\n${text.slice(-MAX_TRANSCRIPT_CHARS)}`;
  }
  return text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Map an upstream HTTP failure to an AIError with an actionable message. */
function providerHttpError(provider, status, bodyText) {
  const detail = (bodyText || '').slice(0, 300);
  if (status === 401 || status === 403) {
    return new AIError(
      `${provider} rejected the API key (HTTP ${status}). Check the ${provider === 'Gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} value and that the key is allowed to use the selected model.`,
      { code: 'AI_AUTH_ERROR', httpStatus: 502, providerStatus: status, details: detail },
    );
  }
  if (status === 429) {
    return new AIError(
      `${provider} rate limit or quota exceeded (HTTP 429). Try again shortly or check your plan's quota.`,
      { code: 'AI_RATE_LIMITED', httpStatus: 429, providerStatus: status, details: detail },
    );
  }
  if (status === 404) {
    return new AIError(
      `${provider} could not find the requested model or endpoint (HTTP 404). Check the configured model name.`,
      { code: 'AI_MODEL_NOT_FOUND', httpStatus: 502, providerStatus: status, details: detail },
    );
  }
  if (status >= 500) {
    return new AIError(
      `${provider} service is temporarily unavailable (HTTP ${status}). Please try again.`,
      { code: 'AI_UPSTREAM_ERROR', httpStatus: 502, providerStatus: status, details: detail },
    );
  }
  return new AIError(`${provider} request failed (HTTP ${status}).`, {
    code: 'AI_REQUEST_FAILED',
    httpStatus: 502,
    providerStatus: status,
    details: detail,
  });
}

async function readErrorBody(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function extractGeminiText(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
  if (text) return text;
  const blocked = payload?.promptFeedback?.blockReason || candidate?.finishReason;
  if (blocked) {
    throw new AIError(`The AI model returned no text (reason: ${blocked}). Please rephrase and try again.`, {
      code: 'AI_EMPTY_RESPONSE',
      httpStatus: 502,
    });
  }
  throw new AIError('The AI model returned an empty response.', { code: 'AI_EMPTY_RESPONSE', httpStatus: 502 });
}

function geminiRequest({ baseUrl, apiVersion, model, apiKey, authMode }) {
  const url = new URL(`${baseUrl}/${apiVersion}/models/${encodeURIComponent(model)}:generateContent`);
  const headers = { 'content-type': 'application/json' };
  if (authMode === 'bearer') headers.authorization = `Bearer ${apiKey}`;
  else url.searchParams.set('key', apiKey);
  return { url: url.toString(), headers };
}

async function callGemini({ config, systemPrompt, messages, jsonMode = false, fetchImpl }) {
  const { apiKey, model, fallbackModels, baseUrl, apiVersion, authMode, timeoutMs } = config.ai.gemini;
  const contents = transcriptToContents(messages);
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: contents.length
      ? contents
      : [{ role: 'user', parts: [{ text: 'The call has just begun. Greet the customer.' }] }],
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      maxOutputTokens: 800,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
    safetySettings: [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ].map((category) => ({ category, threshold: 'BLOCK_MEDIUM_AND_ABOVE' })),
  };

  // "auto" tries the query-parameter key first, then a Bearer token.
  const authModes = authMode === 'auto' ? ['key', 'bearer'] : [authMode];
  const models = [model, ...fallbackModels];
  let authError = null;

  for (const candidateModel of models) {
    for (const mode of authModes) {
      const { url, headers } = geminiRequest({
        baseUrl,
        apiVersion,
        model: candidateModel,
        apiKey,
        authMode: mode,
      });

      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        try {
          response = await fetchImpl(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
          if (attempt === 0) {
            await sleep(400);
            continue;
          }
          throw new AIError(
            timedOut
              ? `Gemini did not respond within ${Math.round(timeoutMs / 1000)}s. Check the network connection and try again.`
              : `Could not reach Gemini: ${error?.message || 'network error'}. Check outbound network access.`,
            { code: timedOut ? 'AI_TIMEOUT' : 'AI_NETWORK_ERROR', httpStatus: 504 },
          );
        }

        if (response.ok) {
          const payload = await response.json().catch(() => null);
          if (!payload) throw new AIError('Gemini returned a malformed JSON response.', { code: 'AI_BAD_RESPONSE' });
          return { text: extractGeminiText(payload), model: candidateModel };
        }

        const raw = await readErrorBody(response);

        // Auth failures are meaningful: remember them and try the other style.
        if (response.status === 401 || response.status === 403) {
          authError = providerHttpError('Gemini', response.status, raw);
          authError.message =
            'Gemini rejected the credential (HTTP ' +
            response.status +
            '). Tried both ?key= and Authorization: Bearer. Check that GEMINI_API_KEY is a valid AI Studio API key (or a non-expired OAuth access token) with access to the configured model.';
          break;
        }

        const maybeModelMissing =
          response.status === 404 ||
          (response.status === 400 && /not found|unsupported|not supported/i.test(raw));
        if (maybeModelMissing) break; // try the next model / auth mode

        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          await sleep(700);
          continue;
        }
        throw providerHttpError('Gemini', response.status, raw);
      }
    }
  }

  if (authError) throw authError;
  throw new AIError('No configured Gemini model could be reached. Check GEMINI_MODEL.', {
    code: 'AI_MODEL_NOT_FOUND',
    httpStatus: 502,
  });
}

async function callOpenAI({ config, systemPrompt, messages, jsonMode = false, fetchImpl }) {
  const { apiKey, model, baseUrl, timeoutMs } = config.ai.openai;
  const body = {
    model,
    temperature: jsonMode ? 0.2 : 0.6,
    max_tokens: 900,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
        .filter((m) => m.role === 'customer' || m.role === 'assistant')
        .slice(-MAX_HISTORY_MESSAGES)
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    ],
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  if (!body.messages.some((m) => m.role !== 'system')) {
    body.messages.push({ role: 'user', content: 'The call has just begun. Greet the customer.' });
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      if (attempt === 0) {
        await sleep(400);
        continue;
      }
      throw new AIError(
        timedOut
          ? `OpenAI did not respond within ${Math.round(timeoutMs / 1000)}s. Try again.`
          : `Could not reach OpenAI: ${error?.message || 'network error'}.`,
        { code: timedOut ? 'AI_TIMEOUT' : 'AI_NETWORK_ERROR', httpStatus: 504 },
      );
    }
    if (response.ok) {
      const payload = await response.json().catch(() => null);
      const text = payload?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new AIError('OpenAI returned an empty response.', { code: 'AI_EMPTY_RESPONSE' });
      return { text, model };
    }
    const raw = await readErrorBody(response);
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await sleep(700);
      continue;
    }
    throw providerHttpError('OpenAI', response.status, raw);
  }
  throw new AIError('OpenAI request failed after retries.', { code: 'AI_UPSTREAM_ERROR', httpStatus: 502 });
}

async function callModel({ config, systemPrompt, messages, jsonMode = false, fetchImpl = globalThis.fetch }) {
  if (config.ai.provider === 'gemini') {
    return callGemini({ config, systemPrompt, messages, jsonMode, fetchImpl });
  }
  if (config.ai.provider === 'openai') {
    return callOpenAI({ config, systemPrompt, messages, jsonMode, fetchImpl });
  }
  throw new AIError(
    'No AI provider is configured. Set GEMINI_API_KEY (or OPENAI_API_KEY) in the server environment and restart.',
    { code: 'AI_NOT_CONFIGURED', httpStatus: 503 },
  );
}

/** Generate one conversational reply from the real model. */
export async function generateReply({ config, product, language, messages, fetchImpl }) {
  const systemPrompt = buildSystemPrompt({ product, language });
  const result = await callModel({ config, systemPrompt, messages, fetchImpl });
  return { text: result.text, model: result.model, provider: config.ai.provider };
}

const SUMMARY_SCHEMA_DOC = `{
  "summary": "2-3 sentence neutral overview of what was discussed",
  "customerRequirements": ["requirement stated by the customer, in their own words"],
  "questionsAsked": ["questions the customer actually asked"],
  "objections": ["objections or concerns the customer actually raised"],
  "interestLevel": "High | Medium | Low | None",
  "interestReason": "one sentence grounded in the customer's own words",
  "nextSteps": ["concrete next step agreed or offered"],
  "status": "Converted | Interested | Follow-up Required | Not Interested | Demo Requested | No Response"
}`;

export function buildSummaryPrompt({ product, language }) {
  const languageName = LANGUAGE_NAMES[language] || 'English';
  return `You are a sales operations analyst. Analyze the transcript of a sales call about ${product.name} and return a JSON object only.

STRICT RULES
- Use ONLY information that appears in the transcript. Never invent requirements, objections, names, budgets or agreements.
- If a section has no evidence, return an empty array for it (or "None" for interestLevel).
- customerRequirements must be needs the CUSTOMER stated, not features the agent pitched.
- questionsAsked must be questions the customer actually asked.
- objections must be concerns the customer actually expressed.
- nextSteps must be actions actually agreed or clearly offered and accepted in the call.
- Write all free-text fields in ${languageName}, except "status" which must be exactly one of the English labels.

SALES STATUS LABELS (choose exactly one)
- "Converted": the customer explicitly agreed to buy, subscribe, sign up or receive an invoice.
- "Demo Requested": the customer asked for or accepted a product demo/walkthrough.
- "Follow-up Required": the customer asked for details/quote by email, a callback, or another conversation later.
- "Interested": positive engagement, asked substantive questions, but no explicit next step.
- "Not Interested": the customer said they are not interested, declined, or asked not to be contacted.
- "No Response": the customer never replied.
Do not choose "Converted" unless the transcript shows an explicit purchase commitment.

Return JSON with exactly this shape:
${SUMMARY_SCHEMA_DOC}`;
}

function safeString(value, max = 600) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function safeStringArray(value, max = 12, maxLen = 400) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return Object.values(item).filter((v) => typeof v === 'string').join(' — ').trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, max)
    .map((item) => item.slice(0, maxLen));
}

function parseJsonLoose(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const INTEREST_LEVELS = new Set(['High', 'Medium', 'Low', 'None']);

function normalizeInterestLevel(value) {
  const cleaned = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const map = { high: 'High', medium: 'Medium', low: 'Low', none: 'None', unknown: 'None' };
  return map[cleaned] || null;
}

/**
 * Deterministic keyword classifier over the actual customer messages.
 * Used only when the AI classification is missing or invalid; always reported
 * to the UI with `classificationSource: 'rules'` so nothing is misrepresented.
 */
export function classifyFromTranscript(messages) {
  const customerTurns = messages.filter((m) => m.role === 'customer' && m.content.trim());
  if (customerTurns.length === 0) {
    return { status: 'No Response', matchedOn: 'no customer messages' };
  }
  const text = customerTurns.map((m) => m.content.toLowerCase()).join(' \n ');

  const patterns = [
    {
      status: 'Converted',
      words: [
        'buy it', "i'll buy", 'i will buy', 'sign me up', 'sign us up', 'subscribe', 'purchase',
        'send me the invoice', 'send the invoice', 'let us proceed', "let's proceed", 'close the deal',
        'i will take it', "i'll take it", 'credit card', 'payment link', 'खरीद', 'ले लूंगा', 'ले लूँगा',
        'सब्सक्राइब', 'इनवॉइस', 'भुगतान',
      ],
    },
    {
      status: 'Not Interested',
      words: [
        'not interested', 'no thanks', 'not for us', "don't need", 'do not need', "don't contact",
        'stop calling', 'no requirement', 'not required', 'no need',
        'रुचि नहीं', 'ज़रूरत नहीं', 'जरूरत नहीं', 'नहीं चाहिए', 'इंटरेस्ट नहीं',
      ],
    },
    {
      status: 'Demo Requested',
      words: ['demo', 'walkthrough', 'walk through', 'show me', 'screen share', 'डेमो', 'दिखा', 'प्रदर्शन'],
    },
    {
      status: 'Follow-up Required',
      words: [
        'send me', 'email me', 'call me later', 'follow up', 'follow-up', 'quote', 'proposal',
        'share details', 'send details', 'tomorrow', 'next week', 'brochure', 'pricing sheet',
        'ईमेल', 'कॉल कर', 'जानकारी भेज', 'विवरण भेज', 'कल बात',
      ],
    },
    {
      status: 'Interested',
      words: [
        'interested', 'tell me more', 'sounds good', 'how does', 'pricing', 'price', 'features',
        'integrate', 'trial', 'security', 'team', 'अच्छा', 'बताइए', 'कीमत', 'फीचर', 'ट्रायल', 'जानकारी',
      ],
    },
  ];

  for (const pattern of patterns) {
    const hit = pattern.words.find((word) => text.includes(word));
    if (hit) return { status: pattern.status, matchedOn: hit };
  }
  return { status: 'Interested', matchedOn: 'customer engaged with substantive replies' };
}

/**
 * Turn the model's raw JSON into a validated summary object.
 * Returns `statusSource` so the caller can be explicit about provenance.
 */
export function normalizeSummary(rawSummary, messages) {
  const customerTurns = messages.filter((m) => m.role === 'customer' && m.content.trim());
  if (customerTurns.length === 0) {
    return {
      summary: {
        summary: 'The customer did not respond during this call, so no requirements, questions or objections were recorded.',
        customerRequirements: [],
        questionsAsked: [],
        objections: [],
        interestLevel: 'None',
        interestReason: 'No customer messages were captured in the transcript.',
        nextSteps: [],
        status: 'No Response',
      },
      status: 'No Response',
      statusSource: 'no-conversation',
    };
  }

  const statusFromAi = normalizeStatus(rawSummary?.status);
  const aiStatus = statusFromAi && SALES_STATUSES.includes(statusFromAi) ? statusFromAi : null;
  const interestLevel = normalizeInterestLevel(rawSummary?.interestLevel);
  const ruleFallback = classifyFromTranscript(messages);
  const status = aiStatus || ruleFallback.status;

  const summary = {
    summary: safeString(rawSummary?.summary, 1200) || 'Summary generated from the call transcript.',
    customerRequirements: safeStringArray(rawSummary?.customerRequirements),
    questionsAsked: safeStringArray(rawSummary?.questionsAsked),
    objections: safeStringArray(rawSummary?.objections),
    interestLevel: INTEREST_LEVELS.has(interestLevel) ? interestLevel : 'Medium',
    interestReason: safeString(rawSummary?.interestReason, 600),
    nextSteps: safeStringArray(rawSummary?.nextSteps),
    status,
  };

  // Safety net: never report "Converted" without an explicit purchase signal in
  // the customer's own words. Degrade to the rule-based status instead.
  if (summary.status === 'Converted') {
    const rule = classifyFromTranscript(messages);
    if (rule.status !== 'Converted') {
      summary.status = rule.status;
      summary.nextSteps = summary.nextSteps.length
        ? summary.nextSteps
        : ['Confirm the purchase decision with the customer in the next follow-up.'];
      return { summary, status: summary.status, statusSource: 'rules', adjusted: true };
    }
  }

  return {
    summary,
    status: summary.status,
    statusSource: aiStatus ? 'ai' : 'rules',
    adjusted: false,
  };
}

/** Generate a grounded summary + classification from the real transcript. */
export async function generateSummary({ config, product, language, messages, fetchImpl }) {
  const customerTurns = messages.filter((m) => m.role === 'customer' && m.content.trim());
  if (customerTurns.length === 0) {
    return normalizeSummary(null, messages);
  }

  const systemPrompt = buildSummaryPrompt({ product, language });
  const transcript = clipTranscript(messages);
  const result = await callModel({
    config,
    systemPrompt,
    jsonMode: true,
    fetchImpl,
    messages: [
      {
        role: 'customer',
        content: `Transcript of the sales call:\n\n${transcript}\n\nReturn the JSON analysis now.`,
      },
    ],
  });

  const parsed = parseJsonLoose(result.text);
  if (!parsed || typeof parsed !== 'object') {
    throw new AIError('The AI summary response was not valid JSON. Please retry the summary.', {
      code: 'AI_BAD_SUMMARY_JSON',
      httpStatus: 502,
    });
  }
  const normalized = normalizeSummary(parsed, messages);
  return { ...normalized, model: result.model, provider: config.ai.provider };
}
