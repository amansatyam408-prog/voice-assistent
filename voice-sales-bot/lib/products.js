/**
 * Verified SaaS product knowledge base.
 *
 * These facts are the ONLY product information the AI is allowed to present.
 * The system prompt instructs the model never to invent pricing, features or
 * policy details that are not listed here.
 */
export const PRODUCTS = [
  {
    id: 'flowpilot',
    name: 'FlowPilot',
    tagline: 'Workflow automation for operations teams',
    category: 'Workflow automation',
    description:
      'FlowPilot lets operations teams automate repetitive back-office work with a visual builder, 120+ integrations, approval flows and audit logs.',
    idealCustomer: 'Operations, finance and support teams of 10–500 people drowning in manual hand-offs.',
    pricing: [
      { plan: 'Starter', price: '$19 per user / month', includes: '5 active workflows, 120+ integrations, email support' },
      { plan: 'Growth', price: '$39 per user / month', includes: 'Unlimited workflows, approval chains, audit logs, priority support' },
      { plan: 'Enterprise', price: 'Custom pricing', includes: 'SSO/SAML, dedicated success manager, custom SLAs' },
    ],
    features: [
      'Drag-and-drop workflow builder with version history',
      '120+ native integrations including Slack, Salesforce, HubSpot, Gmail, Jira and Zoho',
      'Conditional logic, loops, approvals and scheduled runs',
      'Audit logs and role-based access control on Growth and above',
      'SOC 2 Type II certified, data encrypted at rest (AES-256) and in transit (TLS 1.2+)',
    ],
    differentiators: [
      'Visual builder that non-engineers can own — no code required',
      'Flat per-user pricing; no per-task or per-run charges',
      'Typical go-live in 2–3 weeks with a guided template library',
    ],
    objections: [
      {
        concern: 'Too expensive',
        answer:
          'Most teams replace 6–10 hours of manual work per person each week. Growth is $39 per user per month and can be billed annually with a 15% discount.',
      },
      {
        concern: 'Migration effort',
        answer:
          'The onboarding team recreates your first three workflows for free, and Zapier/Make imports are supported through a guided importer.',
      },
      {
        concern: 'Security review',
        answer:
          'FlowPilot is SOC 2 Type II certified and offers SSO/SAML on Enterprise plus audit logs on Growth.',
      },
    ],
    policies: {
      trial: '14-day free trial, no credit card required',
      contract: 'Monthly or annual billing; annual plans save 15%',
      cancellation: 'Cancel anytime; data export available for 30 days after cancellation',
      support: 'Email support on Starter, priority support on Growth, dedicated CSM on Enterprise',
    },
    demo: 'A 20-minute live demo with a solutions engineer, scheduled within 2 business days.',
    website: 'flowpilot.example.com',
  },
  {
    id: 'clouddesk',
    name: 'CloudDesk',
    tagline: 'Customer support helpdesk with AI assist',
    category: 'Customer support helpdesk',
    description:
      'CloudDesk is a shared inbox and helpdesk that unifies email, chat and WhatsApp with AI suggested replies, SLA tracking and a self-serve knowledge base.',
    idealCustomer: 'Support teams handling 500–20,000 tickets per month across multiple channels.',
    pricing: [
      { plan: 'Team', price: '$15 per agent / month', includes: 'Shared inbox, email + chat, basic reporting' },
      { plan: 'Pro', price: '$29 per agent / month', includes: 'WhatsApp channel, SLA policies, AI suggested replies, knowledge base' },
      { plan: 'Enterprise', price: 'Custom pricing', includes: 'SSO, custom data residency, 99.9% uptime SLA' },
    ],
    features: [
      'Unified inbox for email, live chat, WhatsApp and social channels',
      'AI suggested replies grounded in your own help centre articles',
      'SLA timers, escalation rules and CSAT surveys',
      'Self-serve knowledge base and customer portal',
      'Reporting on first-response time, resolution time and CSAT',
    ],
    differentiators: [
      'AI suggestions cite the help centre article they came from',
      'WhatsApp support included on Pro — most competitors charge extra',
      'Migration from Zendesk or Freshdesk handled by the onboarding team',
    ],
    objections: [
      {
        concern: 'AI accuracy',
        answer:
          'AI replies are drafted, never auto-sent, and always link the source article so an agent reviews before sending.',
      },
      {
        concern: 'Switching cost',
        answer:
          'Historical tickets, macros and help centre articles are migrated free of charge on annual Pro or Enterprise plans.',
      },
      {
        concern: 'Budget approval',
        answer:
          'A 30-day pilot on one team is available so you can measure deflection and CSAT before a company-wide rollout.',
      },
    ],
    policies: {
      trial: '21-day free trial with full Pro features',
      contract: 'Monthly or annual billing; annual plans save 20%',
      cancellation: 'Cancel anytime, data export included',
      support: '24x5 chat support on Pro, 24x7 on Enterprise',
    },
    demo: 'A 30-minute tailored walkthrough using your own ticket samples.',
    website: 'clouddesk.example.com',
  },
  {
    id: 'teamsync',
    name: 'TeamSync',
    tagline: 'Project management for distributed product teams',
    category: 'Project management',
    description:
      'TeamSync combines sprints, roadmaps, docs and workload planning in one workspace, with async stand-ups for distributed teams.',
    idealCustomer: 'Product and engineering teams of 15–300 people working across time zones.',
    pricing: [
      { plan: 'Basic', price: '$8 per user / month', includes: 'Tasks, boards, docs, 5 GB storage' },
      { plan: 'Business', price: '$16 per user / month', includes: 'Roadmaps, workload planning, time tracking, guest access' },
      { plan: 'Enterprise', price: 'Custom pricing', includes: 'SSO/SAML, audit logs, sandbox environment, 99.9% uptime SLA' },
    ],
    features: [
      'Sprint boards, backlogs and burndown charts',
      'Roadmaps with dependency mapping',
      'Docs and wikis linked directly to tasks',
      'Async video/text stand-ups with automatic summaries',
      'Workload views to spot over-allocation before it burns out the team',
    ],
    differentiators: [
      'Docs, tasks and roadmaps in one tool instead of three',
      'Async stand-up summaries reduce meeting load by an average of 3 hours per person per week',
      'Jira importer preserves history, comments and attachments',
    ],
    objections: [
      {
        concern: 'We already use Jira',
        answer:
          'The Jira importer migrates projects, history and attachments, and TeamSync can run alongside Jira during a parallel pilot.',
      },
      {
        concern: 'Adoption by the team',
        answer:
          'Onboarding includes two live training sessions and a template pack; most teams are fully adopted within 3 weeks.',
      },
      {
        concern: 'Price for large teams',
        answer:
          'Business is $16 per user per month; volume discounts start at 100 seats and Enterprise is custom priced.',
      },
    ],
    policies: {
      trial: '14-day free trial with unlimited seats',
      contract: 'Monthly or annual billing; annual plans save 2 months',
      cancellation: 'Cancel anytime, full workspace export in JSON and CSV',
      support: 'In-app chat on all plans, priority on Business and above',
    },
    demo: 'A 25-minute guided tour plus a free Jira migration assessment.',
    website: 'teamsync.example.com',
  },
  {
    id: 'insightiq',
    name: 'InsightIQ',
    tagline: 'Product analytics without the data team backlog',
    category: 'Product analytics',
    description:
      'InsightIQ is a self-serve product analytics platform with funnels, retention, session replays and warehouse-native queries.',
    idealCustomer: 'Product and growth teams of 5–200 people who need answers without waiting on data engineers.',
    pricing: [
      { plan: 'Startup', price: '$99 per month', includes: '1 million events, 5 seats, funnels and retention' },
      { plan: 'Scale', price: '$399 per month', includes: '10 million events, unlimited seats, session replay, warehouse sync' },
      { plan: 'Enterprise', price: 'Custom pricing', includes: 'SSO, data residency, dedicated support, custom event volume' },
    ],
    features: [
      'Funnels, retention cohorts, and path analysis',
      'Session replays linked to user events',
      'Warehouse-native queries on Snowflake and BigQuery',
      'Feature flags and A/B experiment analysis',
      'GDPR-ready with PII masking and data deletion APIs',
    ],
    differentiators: [
      'Event volume pricing instead of per-seat pricing on Scale',
      'Warehouse-native mode keeps raw data in your own cloud',
      'Setup usually takes under an hour with the SDKs',
    ],
    objections: [
      {
        concern: 'Data privacy',
        answer:
          'PII masking, EU data residency and deletion APIs are available; warehouse-native mode keeps raw events inside your own cloud account.',
      },
      {
        concern: 'Event volume costs',
        answer:
          'Scale includes 10 million events per month; overage is billed at $15 per additional million, and annual commitments include a volume discount.',
      },
      {
        concern: 'Engineering time to instrument',
        answer:
          'The SDK auto-captures core events, and the solutions team helps define your first 20 key events during onboarding.',
      },
    ],
    policies: {
      trial: '30-day free trial with 100,000 events',
      contract: 'Monthly or annual; annual plans include a 10% discount',
      cancellation: 'Cancel anytime; raw data can be exported or kept in your warehouse',
      support: 'Email and in-app chat on all plans, dedicated support on Enterprise',
    },
    demo: 'A 30-minute analytics audit using your current funnel.',
    website: 'insightiq.example.com',
  },
];

export function getProduct(id) {
  return PRODUCTS.find((product) => product.id === id) || null;
}

/** Public product list for the frontend (no secrets involved). */
export function publicProducts() {
  return PRODUCTS.map(({ id, name, tagline, category, description, idealCustomer }) => ({
    id,
    name,
    tagline,
    category,
    description,
    idealCustomer,
  }));
}

/** Compact text form of the knowledge base injected into the AI prompt. */
export function productKnowledge(product) {
  const pricing = product.pricing
    .map((plan) => `- ${plan.plan}: ${plan.price} (${plan.includes})`)
    .join('\n');
  const features = product.features.map((f) => `- ${f}`).join('\n');
  const differentiators = product.differentiators.map((d) => `- ${d}`).join('\n');
  const objections = product.objections
    .map((o) => `- Objection: "${o.concern}" → Approved answer: ${o.answer}`)
    .join('\n');
  const policies = Object.entries(product.policies)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');

  return [
    `Product: ${product.name} — ${product.tagline}`,
    `Category: ${product.category}`,
    `What it does: ${product.description}`,
    `Ideal customer: ${product.idealCustomer}`,
    `Pricing:\n${pricing}`,
    `Key features:\n${features}`,
    `Why teams choose it:\n${differentiators}`,
    `Known objections and approved responses:\n${objections}`,
    `Policies:\n${policies}`,
    `Demo: ${product.demo}`,
  ].join('\n\n');
}
