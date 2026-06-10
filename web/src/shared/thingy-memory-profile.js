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
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
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

function memoryFacts(profile = {}) {
  return profileList(profile.remembered_facts, (item) => {
    const category = cleanMemoryText(item?.category || 'detail', 40);
    const value = usefulMemoryText(item?.value || item, 220);
    return value ? { id: item?.id || '', category, value, source: cleanMemoryText(item?.source || '', 120), remembered_at: item?.remembered_at || '' } : null;
  }).slice(-6);
}

function memoryInterests(profile = {}) {
  return profileList(profile.interests, (item) => usefulMemoryText(item, 80)).slice(-8);
}

function memoryInterestItems(profile = {}) {
  return memoryInterests(profile).map((value) => ({
    id: `interest:${value.toLowerCase()}`,
    value
  }));
}

function memoryQuestions(profile = {}) {
  return profileList(profile.current_session_questions, (item) => (
    usefulMemoryText(item?.question || item, 180)
  )).slice(-4);
}

function memoryQuestionItems(profile = {}) {
  return profileList(profile.current_session_questions, (item) => {
    const value = usefulMemoryText(item?.question || item, 180);
    return value ? { id: item?.id || '', value, ts: item?.ts || '' } : null;
  }).slice(-4);
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
  return profileList(profile.synthesized_memories, (item) => {
    const label = usefulMemoryText(item?.label || '', 160);
    const summary = usefulMemoryText(item?.summary || '', 420);
    return label || summary ? {
      id: item?.id || '',
      type: item?.type || 'learned',
      label: label || summary.slice(0, 80),
      summary,
      confidence: Number(item?.confidence || 0),
      evidence: Array.isArray(item?.evidence) ? item.evidence : [],
      synthesized_at: item?.synthesized_at || ''
    } : null;
  }).slice(-8);
}

function memorySignalCount(profile = {}) {
  return (
    memoryFacts(profile).length +
    memoryInterests(profile).length +
    memoryLearnedItems(profile).length +
    memoryQuestions(profile).length +
    memorySummaries(profile).length
  );
}

export {
  cleanMemoryText,
  memoryFacts,
  memoryInterestItems,
  memoryInterests,
  memoryLearnedItems,
  memoryQuestionItems,
  memoryQuestions,
  memorySignalCount,
  memorySummaryItems,
  memorySummaries,
  usefulMemoryText
};
