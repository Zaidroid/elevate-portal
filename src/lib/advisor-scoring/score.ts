// Pure scoring functions — ported from /Users/zaidsalem/Zlab/Advisors/
// src/utils/scoring.ts. No React, no IO. Same outputs as the standalone app
// for the same input + config.
//
// Field-name remap: the standalone app uses camelCase like `techRating`,
// `expAreas`. The portal's Advisor type uses snake_case
// (`tech_rating`, `exp_areas`) because that's what the sheet column names are.
// All field reads here use snake_case; the algorithm is otherwise unchanged.

import type {
  Advisor,
  CategoryConfig,
  CategoryKey,
  ScoringConfig,
  Stage1Parts,
  Stage1Score,
  Stage2Score,
} from '../../types/advisor';
import { DEFAULT_SCORING_CONFIG } from './config';

export function computeStage1(
  adv: Partial<Advisor>,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): Stage1Score {
  const w = config.stage1_weights;

  // 1. Tech rating (1-5)
  const techVal = parseFloat(adv.tech_rating || '0');
  const techScore = isNaN(techVal) ? 0 : (Math.min(techVal, 5) / 5) * w.tech_rating;

  // 2. Ecosystem rating (1-5)
  const ecoVal = parseFloat(adv.eco_rating || '0');
  const ecoScore = isNaN(ecoVal) ? 0 : (Math.min(ecoVal, 5) / 5) * w.eco_rating;

  // 3. C-level Y/N
  const clevelScore = /yes/i.test(adv.c_level || '') ? w.clevel : 0;

  // 4. Years bucket — lookup with substring fallback so "more than 10 years"
  // still maps to "more than 10".
  const yearsBucket = (adv.years || '').toLowerCase().trim();
  const yearsMult =
    config.years_multipliers[yearsBucket] ??
    config.years_multipliers[
      Object.keys(config.years_multipliers).find(k =>
        yearsBucket.includes(k.toLowerCase())
      ) || ''
    ] ??
    0;
  const yearsScore = yearsMult * w.years;

  // 5. Experience areas + detail
  const expAreasText = adv.exp_areas || '';
  const expDetailText = adv.exp_detail || '';
  let areaCount = 0;
  if (/yes/i.test(expAreasText) || expAreasText.includes(',')) {
    areaCount = expAreasText.split(',').filter(a => a.trim().length > 0).length;
  }
  areaCount = Math.min(areaCount, 5);
  const hasDetail = expDetailText.trim().length > 10 ? 1 : 0;
  const expRatio = Math.min((areaCount / 5) * 0.7 + hasDetail * 0.3, 1);
  const experienceScore =
    /yes/i.test(expAreasText) || areaCount > 0 ? expRatio * w.experience : 0;

  // 6. Seniority — title keyword match, first hit wins.
  const posLow = (adv.position || '').toLowerCase();
  let seniorityMult = 0;
  for (const tier of config.seniority_tiers) {
    if (posLow.includes(tier.keyword.toLowerCase())) {
      seniorityMult = tier.score;
      break;
    }
  }
  // Floor for "has any employer at all" so blank-position rows still score
  // a little when they list a real employer.
  if (seniorityMult === 0 && (adv.employer || '').trim().length > 2) {
    seniorityMult = 0.25;
  }
  const seniorityScore = seniorityMult * w.seniority;

  // 7. LinkedIn — full profile URL gets full credit, partial gets half.
  const li = (adv.linkedin || '').trim();
  let linkedinScore = 0;
  if (li.includes('linkedin.com/in/') || li.includes('linkedin.com/')) {
    linkedinScore = w.linkedin;
  } else if (li.length > 2 && !li.includes(' ')) {
    linkedinScore = w.linkedin * 0.5;
  }

  // 8. CV
  const cvScore = (adv.cv_link || '').trim().length > 5 ? w.cv : 0;

  const parts: Stage1Parts = {
    tech_rating: Math.round(techScore),
    eco_rating: Math.round(ecoScore),
    clevel: Math.round(clevelScore),
    years: Math.round(yearsScore),
    experience: Math.round(experienceScore),
    seniority: Math.round(seniorityScore),
    linkedin: Math.round(linkedinScore),
    cv: Math.round(cvScore),
  };

  const total = Object.values(parts).reduce((s, v) => s + v, 0);

  return {
    total,
    parts,
    pass: total >= config.stage1_threshold,
  };
}

export function computeStage2(
  adv: Partial<Advisor>,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): Stage2Score {
  const ceoScore = computeCategoryScore(adv, config.category_ceo, 'ceo');
  const ctoScore = computeCategoryScore(adv, config.category_cto, 'cto');
  const cooScore = computeCategoryScore(adv, config.category_coo, 'coo');
  const marketingScore = computeCategoryScore(adv, config.category_marketing, 'marketing');
  const aiScore = computeCategoryScore(adv, config.category_ai, 'ai');

  const scores: Record<CategoryKey, number> = {
    CEO: ceoScore,
    CTO: ctoScore,
    COO: cooScore,
    Marketing: marketingScore,
    AI: aiScore,
  };

  const maxScore = Math.max(...Object.values(scores));
  let primary: CategoryKey = 'CEO';
  if (maxScore === 0) {
    primary = 'CEO';
  } else {
    const ties = (Object.entries(scores) as [CategoryKey, number][])
      .filter(([, s]) => s === maxScore);
    if (ties.length === 1) {
      primary = ties[0][0];
    } else if (config.category_tiebreaker === 'ceo_first') {
      primary = ties.find(([k]) => k === 'CEO')?.[0] || ties[0][0];
    } else {
      // raw_signal_count: count keyword hits per tied category
      const counts: Record<string, number> = {};
      for (const [cat] of ties) {
        const cfg = getCategoryConfig(config, cat);
        counts[cat] = countSignalHits(adv, cfg);
      }
      primary = ties.sort((a, b) => (counts[b[0]] || 0) - (counts[a[0]] || 0))[0][0];
    }
  }

  return {
    ceo: Math.round(ceoScore),
    cto: Math.round(ctoScore),
    coo: Math.round(cooScore),
    marketing: Math.round(marketingScore),
    ai: Math.round(aiScore),
    primary,
  };
}

function getCategoryConfig(config: ScoringConfig, key: CategoryKey): CategoryConfig {
  switch (key) {
    case 'CEO': return config.category_ceo;
    case 'CTO': return config.category_cto;
    case 'COO': return config.category_coo;
    case 'Marketing': return config.category_marketing;
    case 'AI': return config.category_ai;
  }
}

function computeCategoryScore(
  adv: Partial<Advisor>,
  cat: CategoryConfig,
  catKey: string
): number {
  const allText = [
    adv.non_tech_subjects || '',
    adv.exp_areas || '',
    adv.exp_detail || '',
    adv.c_level_detail || '',
    adv.notes || '',
    adv.position || '',
    adv.support_in || '',
    adv.support_via || '',
    adv.tech_specs || '',
  ]
    .join(' ')
    .toLowerCase();

  // Keyword hits cap at 40
  let keywordScore = 0;
  for (const kw of cat.keywords) {
    if (allText.includes(kw.toLowerCase())) keywordScore += 5;
  }
  keywordScore = Math.min(keywordScore, 40);

  // Area weights cap at 30
  let areaScore = 0;
  const subjects = (adv.non_tech_subjects || '').split(',').map(s => s.trim());
  for (const subj of subjects) {
    for (const [area, weight] of Object.entries(cat.areaWeights)) {
      if (subj.toLowerCase().includes(area.toLowerCase())) {
        areaScore += weight * 5;
      }
    }
  }
  areaScore = Math.min(areaScore, 30);

  // Title boost
  const pos = (adv.position || '').toLowerCase();
  let titleScore = 0;
  for (const tk of getTitleKeywords(catKey)) {
    if (pos.includes(tk)) {
      titleScore = cat.titleBoost;
      break;
    }
  }

  // Tech rating bias — only applies to CTO / AI
  let techBias = 0;
  if (cat.techRatingBias > 0) {
    const techVal = parseFloat(adv.tech_rating || '0');
    if (!isNaN(techVal) && techVal >= cat.techRatingBias) techBias = 10;
  }

  // C-level detail boost — first 5 keywords in c_level_detail count for 3 each, cap 15.
  let cLevelBoost = 0;
  if (/yes/i.test(adv.c_level || '') && (adv.c_level_detail || '').length > 10) {
    const detail = (adv.c_level_detail || '').toLowerCase();
    for (const kw of cat.keywords.slice(0, 5)) {
      if (detail.includes(kw.toLowerCase())) cLevelBoost += 3;
    }
    cLevelBoost = Math.min(cLevelBoost, 15);
  }

  return Math.min(keywordScore + areaScore + titleScore + techBias + cLevelBoost, 100);
}

function getTitleKeywords(catKey: string): string[] {
  switch (catKey) {
    case 'ceo':
      return ['ceo', 'founder', 'managing director', 'chief executive'];
    case 'cto':
      return ['cto', 'vp engineering', 'chief technology', 'head of engineering'];
    case 'coo':
      return ['coo', 'vp operations', 'chief operating', 'head of operations'];
    case 'marketing':
      return ['cmo', 'marketing', 'branding', 'chief marketing', 'head of marketing', 'vp marketing'];
    case 'ai':
      return ['data scientist', 'machine learning', 'ai', 'artificial intelligence', 'head of ai', 'chief ai'];
    default:
      return [];
  }
}

function countSignalHits(adv: Partial<Advisor>, cat: CategoryConfig): number {
  const allText = [
    adv.non_tech_subjects, adv.exp_areas, adv.exp_detail,
    adv.c_level_detail, adv.position, adv.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return cat.keywords.filter(kw => allText.includes(kw.toLowerCase())).length;
}

// Score a full advisor: Stage 1 always, Stage 2 only if Stage 1 passes.
export function scoreAdvisor(
  adv: Partial<Advisor>,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): { stage1: Stage1Score; stage2: Stage2Score } {
  const stage1 = computeStage1(adv, config);
  const stage2 = stage1.pass
    ? computeStage2(adv, config)
    : { ceo: 0, cto: 0, coo: 0, marketing: 0, ai: 0, primary: 'Unqualified' as const };
  return { stage1, stage2 };
}
