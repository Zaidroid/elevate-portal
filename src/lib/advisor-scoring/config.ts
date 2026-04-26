// Default scoring configuration — ported verbatim from
// /Users/zaidsalem/Zlab/Advisors/src/config/scoring.ts. Same weights, same
// thresholds, same keyword lists, so a portal-computed score matches a
// standalone-app-computed score for any given advisor.

import type {
  CategoryConfig,
  ScoringConfig,
  SeniorityTier,
  Stage1Weights,
} from '../../types/advisor';

export const DEFAULT_STAGE1_WEIGHTS: Stage1Weights = {
  tech_rating: 15,
  eco_rating: 10,
  clevel: 20,
  years: 15,
  experience: 15,
  seniority: 10,
  linkedin: 10,
  cv: 5,
};

export const DEFAULT_STAGE1_THRESHOLD = 50;

export const DEFAULT_YEARS_MULTIPLIERS: Record<string, number> = {
  'less than 5': 0.4,
  '5-10': 0.75,
  'more than 10': 1.0,
};

// First match wins, order matters. Founders / C-level land at 1.0,
// individual contributors at 0.3.
export const DEFAULT_SENIORITY_TIERS: SeniorityTier[] = [
  { keyword: 'founder', score: 1.0 },
  { keyword: 'ceo', score: 1.0 },
  { keyword: 'cto', score: 1.0 },
  { keyword: 'coo', score: 1.0 },
  { keyword: 'cfo', score: 0.95 },
  { keyword: 'cmo', score: 0.95 },
  { keyword: 'cbo', score: 0.95 },
  { keyword: 'vp', score: 0.9 },
  { keyword: 'vice president', score: 0.9 },
  { keyword: 'director', score: 0.85 },
  { keyword: 'head of', score: 0.8 },
  { keyword: 'managing director', score: 0.85 },
  { keyword: 'managing partner', score: 0.85 },
  { keyword: 'partner', score: 0.8 },
  { keyword: 'principal', score: 0.75 },
  { keyword: 'senior manager', score: 0.7 },
  { keyword: 'manager', score: 0.6 },
  { keyword: 'lead', score: 0.55 },
  { keyword: 'senior', score: 0.5 },
  { keyword: 'consultant', score: 0.45 },
  { keyword: 'advisor', score: 0.45 },
  { keyword: 'specialist', score: 0.4 },
  { keyword: 'coordinator', score: 0.35 },
  { keyword: 'engineer', score: 0.3 },
];

export const DEFAULT_CATEGORY_CEO: CategoryConfig = {
  keywords: [
    'strategic planning', 'business advisory', 'sales', 'fundraising',
    'board', 'strategy', 'exits', 'growth', 'business development',
    'leadership', 'mentoring', 'entrepreneurship', 'startup', 'venture',
    'investment', 'partnership', 'revenue', 'scaling',
  ],
  areaWeights: {
    'Strategic Planning': 3,
    'Business Advisory': 3,
    'Sales': 2,
    'Marketing and Branding': 2,
    'Financial Management': 1,
  },
  titleBoost: 15,
  techRatingBias: 0,
};

export const DEFAULT_CATEGORY_CTO: CategoryConfig = {
  keywords: [
    'engineering', 'product management', 'software', 'development',
    'architecture', 'cloud', 'infrastructure', 'devops', 'data science',
    'full stack', 'frontend', 'backend', 'mobile', 'security', 'platform',
    'web development', 'api', 'database', 'system design',
  ],
  areaWeights: {
    'Engineering': 3,
    'Product Management': 2,
  },
  titleBoost: 15,
  techRatingBias: 4,
};

export const DEFAULT_CATEGORY_COO: CategoryConfig = {
  keywords: [
    'hr and talent management', 'financial management', 'legal advisory',
    'health management', 'operations', 'compliance', 'supply chain',
    'process', 'logistics', 'risk management', 'quality', 'administration',
    'procurement', 'governance',
  ],
  areaWeights: {
    'HR and Talent Management': 3,
    'Financial Management': 3,
    'Legal Advisory': 2,
    'Health Management': 2,
  },
  titleBoost: 15,
  techRatingBias: 0,
};

export const DEFAULT_CATEGORY_MARKETING: CategoryConfig = {
  keywords: [
    'marketing', 'branding', 'brand strategy', 'digital marketing',
    'content', 'social media', 'seo', 'advertising', 'creative',
    'communications', 'public relations', 'media', 'copywriting',
    'growth marketing', 'demand generation', 'go-to-market', 'storytelling',
    'market research', 'customer acquisition', 'campaign',
  ],
  areaWeights: {
    'Marketing and Branding': 4,
    'Sales': 2,
    'Strategic Planning': 1,
  },
  titleBoost: 15,
  techRatingBias: 0,
};

export const DEFAULT_CATEGORY_AI: CategoryConfig = {
  keywords: [
    'artificial intelligence', 'machine learning', 'deep learning',
    'natural language processing', 'nlp', 'computer vision', 'ai',
    'neural network', 'large language model', 'llm', 'data science',
    'tensorflow', 'pytorch', 'generative ai', 'automation',
    'predictive analytics', 'recommendation system', 'transformer',
    'reinforcement learning', 'chatbot',
  ],
  areaWeights: {
    'Engineering': 2,
    'Product Management': 1,
  },
  titleBoost: 15,
  techRatingBias: 4,
};

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  stage1_threshold: DEFAULT_STAGE1_THRESHOLD,
  stage1_weights: DEFAULT_STAGE1_WEIGHTS,
  years_multipliers: DEFAULT_YEARS_MULTIPLIERS,
  seniority_tiers: DEFAULT_SENIORITY_TIERS,
  category_ceo: DEFAULT_CATEGORY_CEO,
  category_cto: DEFAULT_CATEGORY_CTO,
  category_coo: DEFAULT_CATEGORY_COO,
  category_marketing: DEFAULT_CATEGORY_MARKETING,
  category_ai: DEFAULT_CATEGORY_AI,
  category_tiebreaker: 'raw_signal_count',
};

// Category metadata for UI display
export const CATEGORY_META: Record<
  string,
  { label: string; tone: string; blurb: string }
> = {
  CEO: { label: 'CEO', tone: 'amber', blurb: 'Strategy, leadership, board readiness' },
  CTO: { label: 'CTO', tone: 'teal', blurb: 'Technical architecture, engineering leadership' },
  COO: { label: 'COO', tone: 'green', blurb: 'Operations, finance, HR, legal, process' },
  Marketing: { label: 'Marketing', tone: 'red', blurb: 'Branding, digital marketing, growth' },
  AI: { label: 'AI Specialist', tone: 'orange', blurb: 'Machine learning, AI, data science' },
  Unqualified: { label: 'Unqualified', tone: 'slate', blurb: 'Did not pass Stage 1 threshold' },
};

// Pipeline column definitions used by the portal Advisors kanban. Order
// matches the standalone app's PipelineView so muscle memory carries over.
export const PIPELINE_COLUMNS: { id: AdvisorPipelineId; label: string; tone: string }[] = [
  { id: 'new', label: 'New', tone: 'slate' },
  { id: 'acknowledged', label: 'Acknowledged', tone: 'teal' },
  { id: 'allocated', label: 'Allocated', tone: 'navy' },
  { id: 'intro_sched', label: 'Intro Scheduled', tone: 'amber' },
  { id: 'intro_done', label: 'Intro Done', tone: 'amber' },
  { id: 'assessment', label: 'Assessment', tone: 'orange' },
  { id: 'approved', label: 'Approved', tone: 'green' },
  { id: 'matched', label: 'Matched', tone: 'green' },
  { id: 'on_hold', label: 'On Hold', tone: 'slate' },
  { id: 'rejected', label: 'Rejected', tone: 'red' },
];

export type AdvisorPipelineId =
  | 'new'
  | 'acknowledged'
  | 'allocated'
  | 'intro_sched'
  | 'intro_done'
  | 'assessment'
  | 'approved'
  | 'rejected'
  | 'matched'
  | 'on_hold';
