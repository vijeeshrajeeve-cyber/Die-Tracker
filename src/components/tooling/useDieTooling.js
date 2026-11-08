import { useEffect, useState } from 'react';
import { toolingsAPI } from '../../api';

const lineOf = (links) => {
  const seen = new Set();
  const parts = [];
  for (const link of links || []) {
    const number = link.tooling_number;
    if (!number || seen.has(number)) continue;
    seen.add(number);
    const kind = link.kind || link.tooling?.kind;
    parts.push(kind ? `${number} (${kind})` : number);
  }
  return parts.length ? `Current tooling: ${parts.join(', ')}` : 'Current tooling: none recorded';
};

// "Current tooling: …" for a die, from its die_tooling_links (GET /api/toolings/for-die).
// Answers null while loading or when no die number is given.
export default function useDieTooling(dieNo, plant) {
  const key = dieNo ? `${dieNo}|${plant ?? ''}` : null;
  const [answer, setAnswer] = useState({ key: null, text: null });

  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    toolingsAPI.forDie(dieNo, plant)
      .then((data) => { if (active) setAnswer({ key, text: lineOf(data?.links) }); })
      .catch(() => { if (active) setAnswer({ key, text: 'Current tooling: could not be loaded' }); });
    return () => { active = false; };
  }, [key, dieNo, plant]);

  return key && answer.key === key ? answer.text : null;
}
