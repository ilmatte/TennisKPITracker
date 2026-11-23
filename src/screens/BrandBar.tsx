import './BrandBar.css';
import { ProfileButton } from '../features/auth/ProfileButton';
import tennisLogo from '../assets/logo.svg';

/** Logo + "Tennis KPI Tracker" (top left) and profile button (top right).
 *  Positioned absolutely: the parent screen must be `position: relative`. */
export function BrandBar({ shadow = false }: { shadow?: boolean }) {
  return <>
    <div className={`brand-bar-logo${shadow ? ' shadow' : ''}`}>
      <img src={tennisLogo} alt="" />
      <div>Tennis<br />KPI Tracker</div>
    </div>
    <ProfileButton className="brand-bar-profile" />
  </>;
}
