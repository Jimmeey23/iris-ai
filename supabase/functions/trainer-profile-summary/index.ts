const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type TrainerSummaryInput = {
  trainerName: string;
  averageScore: number;
  reviewCount: number;
  topStrengths: string[];
  attentionAreas: string[];
  recentFeedback: string[];
  trend: string;
  classTypes: string[];
  studios: string[];
};

function cleanList(values: string[], limit = 3): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function trendPhrase(trend: string): string {
  if (trend === 'improving') return 'an improving trajectory';
  if (trend === 'declining') return 'a trend that needs coaching attention';
  return 'a stable performance pattern';
}

function buildFallbackSummary(input: TrainerSummaryInput): string {
  const trainerName = input.trainerName.trim() || 'This instructor';
  const reviewCount = Number.isFinite(input.reviewCount) ? Math.max(0, Math.round(input.reviewCount)) : 0;
  const averageScore = Number.isFinite(input.averageScore) ? Math.round(input.averageScore) : 0;
  const strengths = cleanList(input.topStrengths);
  const attentionAreas = cleanList(input.attentionAreas);
  const classTypes = cleanList(input.classTypes, 2);
  const studios = cleanList(input.studios, 2);
  const reviewLabel = `${reviewCount} assessment${reviewCount === 1 ? '' : 's'}`;
  const context = [classTypes.join(', '), studios.join(', ')].filter(Boolean).join(' across ');

  const firstSentence = `${trainerName} is averaging ${averageScore}% across ${reviewLabel}${context ? `, with recent work in ${context}` : ''}, showing ${trendPhrase(input.trend)}.`;
  const strengthSentence = strengths.length
    ? `The strongest recurring signals are ${strengths.join(', ')}.`
    : 'The profile does not yet have enough scored strengths to identify a consistent standout area.';
  const coachingSentence = attentionAreas.length
    ? `The next coaching focus should be ${attentionAreas.join(', ')}.`
    : 'Continue collecting assessments to sharpen the next coaching focus.';

  return [firstSentence, strengthSentence, coachingSentence].join(' ');
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  console.log('[trainer-summary] Calling OpenAI gpt-5.4-mini');
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_completion_tokens: 300,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => String(resp.status));
    throw new Error(`OpenAI HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content: string = (data?.choices?.[0]?.message?.content ?? '').trim();
  if (!content) throw new Error('OpenAI returned empty content');
  console.log('[trainer-summary] OpenAI success');
  return content;
}

function buildPrompt(
  trainerName: string,
  averageScore: number,
  reviewCount: number,
  topStrengths: string[],
  attentionAreas: string[],
  recentFeedback: string[],
  trend: string,
  classTypes: string[],
  studios: string[],
): string {
  const trendLabel =
    trend === 'improving'
      ? 'showing positive trajectory'
      : trend === 'declining'
      ? 'showing a decline requiring attention'
      : 'maintaining a consistent level';

  return [
    'You are an expert fitness training coach writing a concise performance profile for an instructor at Physique 57 India, a premium Barre and fitness studio.',
    '',
    `Instructor: ${trainerName}`,
    `Average Score: ${averageScore}% (across ${reviewCount} assessment${reviewCount === 1 ? '' : 's'})`,
    `Performance trend: ${trendLabel}`,
    `Class types: ${classTypes.join(', ') || 'Not specified'}`,
    `Studios: ${studios.join(', ') || 'Not specified'}`,
    '',
    `Demonstrated Strengths: ${topStrengths.join(', ') || 'None identified yet'}`,
    `Coaching Attention Areas: ${attentionAreas.join(', ') || 'None identified yet'}`,
    `Recent evaluator feedback: ${recentFeedback.slice(0, 3).join(' | ') || 'No feedback captured yet'}`,
    '',
    `Write a 2-3 sentence professional performance summary for ${trainerName}. Be specific, warm, and coaching-oriented. Write in third person. No bullet points. Return ONLY the summary paragraph.`,
  ].join('\n');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return json({ error: 'Invalid JSON body' }, 400);

    const body = raw as Record<string, unknown>;
    const trainerName = typeof body.trainerName === 'string' ? body.trainerName.trim() : '';
    if (!trainerName) return json({ error: 'trainerName is required' }, 400);

    const averageScore = Number(body.averageScore ?? 0);
    const reviewCount = Number(body.reviewCount ?? 0);
    const topStrengths = Array.isArray(body.topStrengths) ? (body.topStrengths as string[]) : [];
    const attentionAreas = Array.isArray(body.attentionAreas) ? (body.attentionAreas as string[]) : [];
    const recentFeedback = Array.isArray(body.recentFeedback) ? (body.recentFeedback as string[]) : [];
    const trend = typeof body.trend === 'string' ? body.trend : 'stable';
    const classTypes = Array.isArray(body.classTypes) ? (body.classTypes as string[]) : [];
    const studios = Array.isArray(body.studios) ? (body.studios as string[]) : [];
    const summaryInput = {
      trainerName,
      averageScore,
      reviewCount,
      topStrengths,
      attentionAreas,
      recentFeedback,
      trend,
      classTypes,
      studios,
    };
    const fallbackSummary = buildFallbackSummary(summaryInput);

    console.log(`[trainer-summary] Generating summary for ${trainerName} (${reviewCount} reviews, ${averageScore}%)`);

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      console.warn('[trainer-summary] OPENAI_API_KEY not configured; returning deterministic fallback');
      return json({ summary: fallbackSummary, source: 'fallback' });
    }

    const prompt = buildPrompt(trainerName, averageScore, reviewCount, topStrengths, attentionAreas, recentFeedback, trend, classTypes, studios);
    try {
      const summary = await callOpenAI(apiKey, prompt);
      return json({ summary, source: 'openai' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[trainer-summary] OpenAI fallback:', msg);
      return json({ summary: fallbackSummary, source: 'fallback', warning: msg.slice(0, 200) });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[trainer-summary] Error:', msg);
    return json({ error: msg.slice(0, 300) }, 500);
  }
});
