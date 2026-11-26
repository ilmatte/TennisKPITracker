import type { Club } from '../../types';

export type ClubSurface = NonNullable<Club['surface']>;

/** Court surfaces, in display order. Codes match the check constraint on clubs.surface (supabase/initial_schema.sql). */
export const CLUB_SURFACES: readonly { code: ClubSurface; label: string }[] = [
  { code: 'clay', label: 'Terra rossa' },
  { code: 'hard', label: 'Cemento' },
  { code: 'grass', label: 'Erba' },
  { code: 'synthetic', label: 'Sintetico' },
  { code: 'indoor', label: 'Indoor' },
];

export function surfaceLabel(surface: Club['surface']): string | null {
  return CLUB_SURFACES.find(item => item.code === surface)?.label ?? null;
}
