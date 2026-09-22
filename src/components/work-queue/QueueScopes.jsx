import { UserRound, UsersRound, UserRoundPlus } from 'lucide-react';

const SCOPES = [
  { key: 'mine', label: 'My work', Icon: UserRound },
  { key: 'team', label: 'Team', Icon: UsersRound },
  { key: 'unassigned', label: 'Unassigned', Icon: UserRoundPlus },
];

export default function QueueScopes({ scope, counts, onChange }) {
  return <div className="wq-scopes" role="group" aria-label="Queue scope">
    {SCOPES.map(scopeOption => <button key={scopeOption.key} type="button" aria-pressed={scope === scopeOption.key}
      className={`wq-scope${scope === scopeOption.key ? ' is-selected' : ''}`} onClick={() => onChange(scopeOption.key)}>
      <scopeOption.Icon size={16} aria-hidden="true" />{scopeOption.label}<span>{counts?.[scopeOption.key] ?? '—'}</span>
    </button>)}
  </div>;
}
