import { Link } from 'react-router-dom';

const TABS = [
  { key: 'matches', label: 'Partite', to: '/matches' },
  { key: 'tournaments', label: 'Tornei', to: '/tournaments' },
] as const;

/** "Partite | Tornei" header switch: the current section is the page title, underlined in lime; the other one links to
 *  its screen. */
export function MatchesTabs({ active }: { active: (typeof TABS)[number]['key'] }) {
  return <nav className="mg-tabs" aria-label="Sezioni partite">
    {TABS.map(tab => tab.key === active
      ? <div key={tab.key} className="mg-tab current"><h1>{tab.label}</h1><span aria-hidden="true" /></div>
      : <Link key={tab.key} className="mg-tab" to={tab.to}>{tab.label}<span aria-hidden="true" /></Link>)}
  </nav>;
}
