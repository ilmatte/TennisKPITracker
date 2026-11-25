import type { Player } from '../../types';

type Named = Pick<Player, 'first_name' | 'last_name'>;

/** "First Last", or the fallback when the player is unknown. */
export function playerFullName(player: Named | null | undefined, fallback = 'Giocatore'): string {
  return player ? `${player.first_name} ${player.last_name}`.trim() || fallback : fallback;
}

/** Last name (or first name when there is no last name), used in compact match labels such as "Rossi vs Bianchi". */
export function playerShortName(player: Named | null | undefined, fallback = 'Giocatore'): string {
  return player ? player.last_name || player.first_name || fallback : fallback;
}
