import dotenv from 'dotenv';
dotenv.config();

// SaaS Product Knowledge Base
export const SAAS_PRODUCTS = {
  FlowPilot: {
    name: 'FlowPilot',
    category: 'Workflow Automation & Integration Platform',
    tagline: 'Automate repetitive tasks and connect your apps with zero code.',
    overview: 'FlowPilot is a modern workflow automation SaaS that helps operations, marketing, and sales teams eliminate repetitive manual tasks, automate multi-step approvals, and sync data across hundreds of apps.',
    features: [
      'Visual drag-and-drop workflow canvas with 500+ pre-built integrations (Slack, Google Workspace, HubSpot, Salesforce, Stripe)',
      'Smart trigger engine with webhooks, scheduled crons, and event-based listeners',
      'Automated multi-stage approval logic with instant team notifications',
      'Data transformation filters, formulas, and error-recovery retries',
      'Enterprise security with SOC-2 Type II, GDPR compliance, and audit logs'
    ],
    pricing: {
      starter: '$29/month for up to 1,000 tasks and 5 active workflows',
      pro: '$79/month for up to 25,000 tasks, unlimited workflows, and priority support',
      enterprise: 'Custom pricing with dedicated SLA, custom connectors, and SSO/SAML'
    },
    commonObjections: {
      pricing: 'FlowPilot typically saves teams 15+ hours per employee every month, paying for itself within days.',
      complexity: 'FlowPilot is 100% no-code. Non-technical teams can build their first live automated workflow in under 10 minutes.',
      security: 'We are SOC-2 Type II certified and encrypt all data in transit and at rest with AES-256.'
    }
  },
  CloudDesk: {
    name: 'CloudDesk',
    category: 'AI-Powered Customer Support & Omnichannel Helpdesk',
    tagline: 'Delight customers with omnichannel ticketing and intelligent AI responses.',
    overview: 'CloudDesk unifies customer conversations across Email, Live Chat, WhatsApp, and Social into one unified inbox with AI assistance to resolve tickets 3x faster.',
    features: [
      'Unified omnichannel inbox for Email, Web Chat, WhatsApp, and Social',
      'AI-powered draft suggestions, sentiment detection, and ticket summarization',
      'Custom SLA management, automated escalation rules, and business hours routing',
      'Self-service customer portal with interactive knowledge base',
      'Real-time CSAT reporting, agent performance analytics, and team leaderboards'
    ],
    pricing: {
      starter: '$19/agent/month for up to 3 connected inboxes and live chat',
      growth: '$49/agent/month with full omnichannel, AI assist, and custom SLAs',
      enterprise: '$89/agent/month with HIPAA compliance, custom roles, and dedicated IP'
    },
    commonObjections: {
      pricing: 'At $19/agent, CloudDesk reduces resolution times by 40%, boosting customer retention.',
      migration: 'We provide one-click import from Zendesk, Freshdesk, and Intercom with zero downtime.',
      aiTrust: 'Our AI drafts responses for human agents to review and approve before sending.'
    }
  },
  TeamSync: {
    name: 'TeamSync',
    category: 'Agile Project Management & Team Collaboration',
    tagline: 'Keep distributed teams aligned, on schedule, and delivering faster.',
    overview: 'TeamSync combines intuitive Kanban boards, interactive Gantt timelines, resource capacity tracking, and live collaboration docs into one seamless platform.',
    features: [
      'Agile boards (Kanban & Scrum) with custom workflows, WIP limits, and swimlanes',
      'Interactive Gantt timeline with dependency mapping and critical path analysis',
      'Real-time collaborative docs, sprint wikis, and embedded task embeds',
      'Team resource workload balancing and automated burnout alerts',
      'Time tracking, milestone progress tracking, and budget forecasting'
    ],
    pricing: {
      free: 'Free for teams up to 5 users with basic Kanban boards',
      standard: '$12/user/month with unlimited projects, Gantt timelines, and time tracking',
      business: '$24/user/month with resource management, advanced analytics, and SSO'
    },
    commonObjections: {
      pricing: 'Our transparent per-user pricing replaces 3 separate tools (docs, timeline, tracker).',
      learningCurve: 'Designed for instant adoption with pre-configured templates for product, marketing, and design teams.'
    }
  },
  'Custom SaaS': {
    name: 'Custom SaaS',
    category: 'Modern Cloud Software Solution',
    tagline: 'Tailored enterprise software designed to solve your specific operational challenges.',
    overview: 'A high-performance cloud software solution built to automate business processes, improve collaboration, and scale with your organization.',
    features: [
      'Intuitive cloud interface with rapid onboarding',
      'Seamless API integrations with existing enterprise systems',
      'Real-time reporting and actionable business analytics',
      'Enterprise-grade security and role-based permissions'
    ],
    pricing: {
      starter: 'Flexible entry tier starting at $29/month',
      pro: 'Standard business plan at $79/month',
      enterprise: 'Custom enterprise contracts with dedicated support'
    },
    commonObjections: {
      pricing: 'Our solutions are priced to guarantee rapid ROI within the first quarter of deployment.'
    }
  }
};

export const ALLOWED_STATUSES = [
  'Converted',
  'Interested',
  'Follow-up Required',
  'Not Interested',
  'Demo Requested',
  'No Response'
];

/**
 * Check AI configuration status
 */
export function getAiConfig() {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());

  let activeProvider = 'none';
  if (hasGemini) activeProvider = 'gemini';
  else if (hasOpenAI) activeProvider = 'openai';

  return {
    ready: hasGemini || hasOpenAI,
    activeProvider,
    hasGemini,
    hasOpenAI,
    model: hasGemini ? (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite') : hasOpenAI ? 'gpt-4o-mini' : 'none',
    allowOfflineFallback: process.env.ALLOW_OFFLINE_DEMO !== 'false'
  };
}

/**
 * Generate AI voice sales reply
 */
export async function generateSalesReply({
  message,
  product = 'FlowPilot',
  language = 'English',
  history = [],
  customProductInfo = null
}) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('Message is required.');
  }

  const config = getAiConfig();
  const productInfo = customProductInfo || SAAS_PRODUCTS[product] || SAAS_PRODUCTS['Custom SaaS'];

  // If no API key is set
  if (!config.ready) {
    if (config.allowOfflineFallback) {
      return {
        reply: getSimulatedSalesReply(message, productInfo, language),
        source: 'offline_simulation',
        isSimulated: true,
        notice: 'Offline simulation mode: Set GEMINI_API_KEY in .env for live AI responses.'
      };
    }
    throw new Error('No AI API key configured. Please set GEMINI_API_KEY in .env or Settings.');
  }

  // Construct system prompt
  const systemPrompt = buildSalesSystemPrompt(productInfo, language);

  if (config.activeProvider === 'gemini') {
    return await callGeminiForReply(systemPrompt, history, message, language, productInfo);
  } else {
    return await callOpenAIForReply(systemPrompt, history, message, language);
  }
}

/**
 * Call Google Gemini API
 */
async function callGeminiForReply(systemPrompt, history, currentMessage, language, productInfo) {
  const apiKey = process.env.GEMINI_API_KEY;
  const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const fallbackModel = 'gemini-3.5-flash';

  const formatTurn = (m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }]
  });

  const formattedHistory = (history || []).slice(-8).map(formatTurn);
  formattedHistory.push({ role: 'user', parts: [{ text: currentMessage }] });

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: formattedHistory,
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 600,
      topP: 0.95
    }
  };

  const tryModel = async (modelName) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res;
  };

  let res = await tryModel(primaryModel);
  if (!res.ok && res.status === 404) {
    // Try fallback model if primary is not found
    res = await tryModel(fallbackModel);
  }

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errorDetail = errJson.error?.message || errorDetail;
    } catch {}

    const config = getAiConfig();
    if ((res.status === 429 || res.status === 503) && config.allowOfflineFallback) {
      console.warn(`Gemini HTTP ${res.status} rate limit / capacity error, falling back to simulation:`, errorDetail);
      return {
        reply: getSimulatedSalesReply(currentMessage, productInfo, language),
        source: 'offline_simulation',
        isSimulated: true,
        notice: `Gemini service busy (${res.status}). Served via fallback simulation.`
      };
    }

    throw new Error(`Gemini API error: ${errorDetail}`);
  }

  const data = await res.json();
  const replyText = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();

  if (!replyText) {
    throw new Error('Gemini API returned an empty response.');
  }

  return {
    reply: replyText,
    source: 'gemini',
    isSimulated: false,
    model: primaryModel
  };
}

/**
 * Call OpenAI API
 */
async function callOpenAIForReply(systemPrompt, history, currentMessage, language) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history || []).slice(-8).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text
    })),
    { role: 'user', content: currentMessage }
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.5,
      max_tokens: 150
    })
  });

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errorDetail = errJson.error?.message || errorDetail;
    } catch {}
    throw new Error(`OpenAI API error: ${errorDetail}`);
  }

  const data = await res.json();
  const replyText = data.choices?.[0]?.message?.content?.trim();

  if (!replyText) {
    throw new Error('OpenAI returned an empty response.');
  }

  return {
    reply: replyText,
    source: 'openai',
    isSimulated: false,
    model
  };
}

/**
 * Build System Prompt for Live Sales Call
 */
function buildSalesSystemPrompt(product, language) {
  const langInstructions = {
    Hindi: 'Speak in conversational, natural Hindi (Devanagari script or clear Hinglish). Keep vocabulary accessible, respectful, and engaging.',
    Telugu: 'Speak in conversational, polite Telugu. Keep it natural and engaging.',
    English: 'Speak in natural, engaging, professional American/International English.'
  }[language] || 'Speak in English.';

  return `You are Voxly, an intelligent, consultative AI voice sales representative representing ${product.name} (${product.category}).

PRODUCT INFO:
- Tagline: ${product.tagline}
- Overview: ${product.overview}
- Key Features: ${product.features?.join('; ')}
- Pricing: ${JSON.stringify(product.pricing)}

VOICE AGENT RULES:
1. BREVITY: Keep your answer short (1 to 3 sentences, maximum 45 words). This is spoken aloud over voice. Never use markdown lists, asterisks, bullet points, or complex tables.
2. LANGUAGE: ${langInstructions}
3. SALES PSYCHOLOGY:
   - Listen to the customer's question or concern.
   - Answer accurately based on the product details above.
   - Address objections empathetically (e.g., pricing, onboarding, security).
   - End with exactly ONE relevant discovery or closing question (e.g. asking about their team workflow, or offering a quick 10-minute demo).
4. ACCURACY: Never fabricate features, guarantees, or false pricing. If you do not know a custom detail, politely offer to schedule a demo or team follow-up.
5. NEVER sound pushy. Be warm, helpful, confident, and professional.`;
}

/**
 * Generate Structured Call Summary & Classification
 */
export async function generateCallSummary({ transcript = [], product = 'FlowPilot' }) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return {
      summary: 'No conversation turns captured.',
      requirements: [],
      questionsAsked: [],
      objections: [],
      customerInterest: 'No customer interaction occurred.',
      nextSteps: ['Initiate contact when the customer is available.'],
      status: 'No Response',
      source: 'rule_based',
      isSimulated: false
    };
  }

  const config = getAiConfig();
  const productInfo = SAAS_PRODUCTS[product] || SAAS_PRODUCTS['Custom SaaS'];

  // If no customer messages exist
  const customerMessages = transcript.filter(m => m.role === 'customer');
  if (customerMessages.length === 0) {
    return {
      summary: `Call initiated for ${productInfo.name}, but no customer response was received.`,
      requirements: [],
      questionsAsked: [],
      objections: [],
      customerInterest: 'None recorded.',
      nextSteps: ['Follow up with the customer via alternative channels.'],
      status: 'No Response',
      source: 'rule_based',
      isSimulated: false
    };
  }

  if (!config.ready) {
    if (config.allowOfflineFallback) {
      return getSimulatedSummary(transcript, productInfo);
    }
    throw new Error('No AI API key configured to generate summary. Please set GEMINI_API_KEY in .env.');
  }

  const transcriptText = transcript
    .map(m => `${m.role === 'customer' ? 'Customer' : 'Sales Bot'}: ${m.text}`)
    .join('\n');

  const prompt = `You are a Senior Sales Operations Intelligence Analyst. Analyze this actual sales conversation for the SaaS product "${productInfo.name}".

TRANSCRIPT:
${transcriptText}

Extract verified sales intelligence from the transcript. DO NOT invent or assume facts not present in the conversation.
Return a STRICT JSON OBJECT (valid RFC 8259) with EXACTLY these keys:
{
  "summary": "A concise 2-3 sentence overview of what was discussed during the call.",
  "requirements": ["List of specific needs, use cases, or pain points stated by the customer"],
  "questionsAsked": ["List of explicit questions asked by the customer"],
  "objections": ["List of objections, hesitations, pricing concerns, or obstacles raised"],
  "customerInterest": "A concise assessment of customer interest level and specific features they appreciated",
  "nextSteps": ["Actionable next steps for the sales team"],
  "status": "Must be EXACTLY ONE of: Converted, Interested, Follow-up Required, Not Interested, Demo Requested, No Response"
}

STATUS CRITERIA:
- 'Converted': Customer explicitly agreed to buy, subscribe, or initiate payment.
- 'Demo Requested': Customer explicitly asked for a demonstration, product walkthrough, or meeting.
- 'Follow-up Required': Customer asked for an email, requested a callback, or needs to consult their team/manager.
- 'Interested': Customer asked positive questions, explored features or pricing, but did not commit or ask for a demo yet.
- 'Not Interested': Customer explicitly declined, stated they do not need it, or requested to stop calling.
- 'No Response': No customer responses.

Respond with ONLY valid JSON, with no surrounding markdown or explanation.`;

  try {
    let raw = '';
    if (config.activeProvider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1200
          }
        })
      });
      if (!res.ok) throw new Error(`Gemini returned status ${res.status}`);
      const data = await res.json();
      raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    } else {
      const apiKey = process.env.OPENAI_API_KEY;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });
      if (!res.ok) throw new Error(`OpenAI returned status ${res.status}`);
      const data = await res.json();
      raw = data.choices?.[0]?.message?.content?.trim();
    }

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);

    // Validate status
    if (!ALLOWED_STATUSES.includes(parsed.status)) {
      parsed.status = guessSalesStatus(transcript);
    }

    return {
      summary: parsed.summary || 'Summary unavailable.',
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
      questionsAsked: Array.isArray(parsed.questionsAsked) ? parsed.questionsAsked : [],
      objections: Array.isArray(parsed.objections) ? parsed.objections : [],
      customerInterest: parsed.customerInterest || 'Interest level unclassified.',
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
      status: parsed.status,
      source: config.activeProvider,
      isSimulated: false
    };
  } catch (error) {
    if (config.allowOfflineFallback) {
      console.warn('AI summary call failed, falling back to rule-based intelligence:', error.message);
      return getSimulatedSummary(transcript, productInfo);
    }
    throw error;
  }
}

/**
 * Intelligent Rule-Based Classification (Used for fallback & real-time badge updates)
 */
export function guessSalesStatus(transcript = []) {
  const customerTurns = transcript
    .filter(m => m.role === 'customer')
    .map(m => m.text.toLowerCase())
    .join(' ');

  if (!customerTurns.trim()) return 'No Response';

  // Not Interested check
  if (/\b(not interested|no thanks|don't need|dont need|do not need|stop calling|remove me|no interest|waste of time)\b/i.test(customerTurns)) {
    return 'Not Interested';
  }

  // Converted check (explicit purchase intent)
  if (/\b(buy now|purchase|sign me up|subscribe|let's do it|lets do it|send the contract|take my money|where do i pay|ready to buy)\b/i.test(customerTurns)) {
    return 'Converted';
  }

  // Demo Requested check
  if (/\b(demo|show me|demonstration|walkthrough|can i see it|schedule a call|schedule a demo|live demo)\b/i.test(customerTurns)) {
    return 'Demo Requested';
  }

  // Follow-up Required check
  if (/\b(call me back|follow up|later|next week|tomorrow|send me an email|email me|send details|talk to my team|check with my boss|send a quote)\b/i.test(customerTurns)) {
    return 'Follow-up Required';
  }

  // Interested check (default if customer engaged)
  return 'Interested';
}

/**
 * Rule-Based Intelligence Extraction (Offline Simulation)
 */
export function getSimulatedSummary(transcript, productInfo) {
  const customerMessages = transcript.filter(m => m.role === 'customer').map(m => m.text);
  const fullCustomerText = customerMessages.join(' ');
  const lower = fullCustomerText.toLowerCase();

  const status = guessSalesStatus(transcript);

  // Extract questions asked
  const questionsAsked = [];
  customerMessages.forEach(msg => {
    if (msg.includes('?') || /^(what|how|why|can|is|are|does|do|when|where|could|will|क्या|कहाँ|कब|कैसे)/i.test(msg.trim())) {
      questionsAsked.push(msg.trim());
    }
  });

  // Extract objections
  const objections = [];
  if (/pric|cost|expensive|budget|afford|rates|too much/i.test(lower)) {
    objections.push('Pricing or budget constraints mentioned.');
  }
  if (/secur|privacy|compliance|compliant|data|gdpr|soc/i.test(lower)) {
    objections.push('Security or compliance confirmation requested.');
  }
  if (/integrat|connect|slack|hubspot|salesforce/i.test(lower)) {
    objections.push('Integration compatibility with existing tools.');
  }
  if (/difficult|complex|hard|training|learning/i.test(lower)) {
    objections.push('Ease of use and team onboarding concerns.');
  }
  if (/competitor|alternative|using another|already have/i.test(lower)) {
    objections.push('Comparison with existing competitor solutions.');
  }

  // Extract requirements
  const requirements = [];
  if (/automate|repetitive|manual|save time|streamline/i.test(lower)) {
    requirements.push('Wants to automate repetitive workflows and save operational hours.');
  }
  if (/support|tickets|helpdesk|chat|customers/i.test(lower)) {
    requirements.push('Looking for customer support and ticketing management.');
  }
  if (/team|project|track|tasks|sprint|collaboration/i.test(lower)) {
    requirements.push('Needs collaborative project and team management tracking.');
  }
  if (requirements.length === 0 && customerMessages.length > 0) {
    requirements.push(`Expressed interest in ${productInfo.name} capabilities.`);
  }

  // Customer interest assessment
  let customerInterest = 'Customer participated in discussion.';
  if (status === 'Converted') {
    customerInterest = 'High conviction; customer is ready to implement and finalize the purchase.';
  } else if (status === 'Demo Requested') {
    customerInterest = 'High interest; requested a formal demonstration to review features with their team.';
  } else if (status === 'Interested') {
    customerInterest = 'Moderate to strong interest in product features, pricing, and workflow benefits.';
  } else if (status === 'Follow-up Required') {
    customerInterest = 'Cautious interest; requires team consultation or additional collateral before deciding.';
  } else if (status === 'Not Interested') {
    customerInterest = 'Low or no interest at this time.';
  }

  // Next steps
  const nextSteps = {
    'Converted': ['Issue invoice / onboarding link', 'Assign dedicated account onboarding specialist'],
    'Demo Requested': ['Send calendar invite for 15-minute product walkthrough', 'Prepare custom demo environment'],
    'Follow-up Required': ['Send detailed product summary and pricing one-pager by email', 'Schedule follow-up reminder call'],
    'Interested': ['Share product case studies and offer a personalized demo', 'Follow up within 48 hours'],
    'Not Interested': ['Log opt-out reason in CRM', 'Do not contact without customer request'],
    'No Response': ['Attempt re-engagement at another time']
  }[status] || ['Follow up with customer'];

  const summary = customerMessages.length
    ? `Customer engaged in ${transcript.length} turns discussing ${productInfo.name}. Customer shared: "${customerMessages[0].slice(0, 150)}${customerMessages[0].length > 150 ? '...' : ''}"`
    : `No customer interaction occurred during this call for ${productInfo.name}.`;

  return {
    summary,
    requirements,
    questionsAsked,
    objections,
    customerInterest,
    nextSteps,
    status,
    source: 'offline_simulation',
    isSimulated: true
  };
}

/**
 * Fallback / Offline sales replies for testing when no key is set
 */
function getSimulatedSalesReply(message, product, language) {
  const m = message.toLowerCase();
  const isHindi = language === 'Hindi';
  const isTelugu = language === 'Telugu';

  if (/\b(not interested|no thanks|don't need|do not need|stop calling)\b/.test(m)) {
    if (isHindi) return 'समझ गया। आपका समय देने के लिए बहुत धन्यवाद। मैं आगे परेशान नहीं करूँगा। आपका दिन शुभ हो!';
    if (isTelugu) return 'అర్థమైంది. మీ సమయానికి ధన్యవాదాలు. ఇకపై సంప్రదించను.';
    return 'Completely understood. Thank you for your time, and I won’t push at all. Have a great day!';
  }

  if (/\b(demo|show me|walkthrough|demonstrat)\b/.test(m)) {
    if (isHindi) return `ज़रूर! मैं ${product.name} का 10 मिनट का लाइव डेमो तय कर सकता हूँ। आपके लिए कल या परसों में कौन-सा समय ठीक रहेगा?`;
    if (isTelugu) return `ఖచ్చితంగా! నేను ${product.name} డెమోని ఏర్పాటు చేయగలను. రేపు లేదా ఎల్లుండి ఏ సమయం అనుకూలంగా ఉంటుంది?`;
    return `Absolutely! I would love to arrange a quick 10-minute demo of ${product.name} for your team. Would tomorrow morning or afternoon suit you better?`;
  }

  if (/\b(price|pricing|cost|how much|subscription|charge)\b/.test(m)) {
    const starterPrice = product.pricing?.starter || '$29/month';
    if (isHindi) return `${product.name} का प्लान ${starterPrice} से शुरू होता है और इसमें फ्री ट्रायल भी शामिल है। आपकी टीम में कितने लोग इसका उपयोग करेंगे?`;
    if (isTelugu) return `${product.name} ప్లాన్లు ${starterPrice} నుండి ప్రారంభమవుతాయి. మీ బృందంలో ఎంతమంది సభ్యులు ఉన్నారు?`;
    return `${product.name} starts at ${starterPrice} with a full 14-day trial. How many team members would be using it?`;
  }

  if (/\b(feature|what does|how does|what is|integrat|security|explain)\b/.test(m)) {
    if (isHindi) return `${product.name} ${product.tagline} क्या आप अपने मौजूदा टूल्स के साथ इंटीग्रेशन देखना चाहेंगे?`;
    if (isTelugu) return `${product.name} ${product.tagline} మీకు నిర్దిష్ట ఫీచర్ గురించి మరింత సమాచారం కావాలా?`;
    return `${product.name} ${product.tagline} What specific workflow or challenge is your team hoping to improve first?`;
  }

  if (/\b(yes|interested|sounds good|tell me more|sure|okay|ok)\b/.test(m)) {
    if (isHindi) return `बहुत बढ़िया! ${product.name} से आपकी टीम हर हफ़्ते कई घंटे बचा सकती है। आपकी टीम अभी किस मुख्य प्रक्रिया को बेहतर बनाना चाहती है?`;
    if (isTelugu) return `చాలా బాగుంది! ${product.name} మీ బృందానికి ఎంతో సమయం ఆదా చేస్తుంది. మీ ప్రాధాన్యత ఏమిటి?`;
    return `Fantastic! Teams using ${product.name} usually see results in their very first week. What repetitive task currently consumes the most time for your team?`;
  }

  if (isHindi) {
    return `${product.name} के बारे में बताने में मुझे खुशी होगी। यह आपकी टीम को व्यवस्थित रखने और काम को तेज़ी से पूरा करने में मदद करता है। क्या आप एक छोटा डेमो देखना चाहेंगे?`;
  }
  if (isTelugu) {
    return `${product.name} మీ బృందం ఉత్పాదకతను పెంచుతుంది. మీరు చిన్న డెమో చూడాలనుకుంటున్నారా?`;
  }
  return `Thanks for asking. ${product.name} helps teams save hours every week by automating repetitive work. Would you like a quick walkthrough of how it fits your workflow?`;
}
