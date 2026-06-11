const LOW_SIGNAL_MEMORY_PATTERNS = [
  /i don['’]t have (?:any )?(?:previous|prior) context/i,
  /i don['’]t see any previous conversation/i,
  /i do not have (?:any )?(?:previous|prior) context/i,
  /no (?:previous|prior) context/i,
  /could you (?:please )?(?:provide|share|give) (?:me )?more details/i,
  /what topic you['’]d like me to elaborate/i,
  /the chat session or questions you['’]d like me to summarize/i,
  /i['’]d be happy to help,? but/i,
  /please provide (?:the )?(?:chat|conversation|session)/i
];

function cleanMemoryText(value, max = 180) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  const clipped = text.slice(0, Math.max(0, max - 3)).replace(/\s+\S*$/, '');
  return `${clipped || text.slice(0, Math.max(0, max - 3))}...`;
}

function usefulMemoryText(value, max = 180) {
  const text = cleanMemoryText(value, max);
  if (!text) return '';
  if (LOW_SIGNAL_MEMORY_PATTERNS.some((pattern) => pattern.test(text))) return '';
  return text;
}

function profileList(value, mapper) {
  return Array.isArray(value) ? value.map(mapper).filter(Boolean) : [];
}

function memoryQuestions(profile = {}) {
  const source = Array.isArray(profile.recent_prompts) && profile.recent_prompts.length
    ? profile.recent_prompts
    : profile.current_session_questions;
  return profileList(source, (item) => (
    usefulMemoryText(item?.question || item, 180)
  )).slice(-10);
}

function memoryQuestionItems(profile = {}) {
  const source = Array.isArray(profile.recent_prompts) && profile.recent_prompts.length
    ? profile.recent_prompts
    : profile.current_session_questions;
  return profileList(source, (item) => {
    const value = usefulMemoryText(item?.question || item, 180);
    return value ? { id: item?.id || '', value, ts: item?.ts || '' } : null;
  }).slice(-10);
}

function memorySummaries(profile = {}) {
  return profileList(profile.prior_session_summaries, (item) => (
    usefulMemoryText(item?.summary || item, 320)
  )).slice(-3);
}

function memorySummaryItems(profile = {}) {
  return profileList(profile.prior_session_summaries, (item) => {
    const value = usefulMemoryText(item?.summary || item, 320);
    return value ? { id: item?.id || '', value, started_at: item?.started_at || '', ended_at: item?.ended_at || '' } : null;
  }).slice(-3);
}

function memoryLearnedItems(profile = {}) {
  const learnedProfile = Array.isArray(profile.learned_profile) ? profile.learned_profile : [];
  return profileList(learnedProfile, (item) => {
    const label = usefulMemoryText(item?.label || '', 160);
    const summary = usefulMemoryText(item?.summary || '', 420);
    return label || summary ? {
      id: item?.id || '',
      type: item?.type || 'observed_archive_theme',
      label: label || summary.slice(0, 80),
      summary,
      confidence: Number(item?.confidence || 0),
      evidence: Array.isArray(item?.evidence) ? item.evidence : [],
      synthesized_at: item?.synthesized_at || ''
    } : null;
  }).slice(0, 12);
}

function memorySignalCount(profile = {}) {
  return memoryLearnedItems(profile).length;
}

export {
  cleanMemoryText,
  memoryLearnedItems,
  memoryQuestionItems,
  memoryQuestions,
  memorySignalCount,
  memorySummaryItems,
  memorySummaries,
  usefulMemoryText
};
