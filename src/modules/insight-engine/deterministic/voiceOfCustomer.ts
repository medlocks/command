/**
 * Voice-of-customer label formatting (added 7 Sep 2026, per direct
 * request: "building avatar profiles... reading complaints good
 * reviews"). Pure presentation over `handleVoiceOfCustomer`'s
 * already-computed real theme tallies — see that function's own comment
 * for why this deliberately never builds a fabricated persona ("Sarah,
 * 32...") and instead surfaces real recurring themes with real quotes.
 */

/** Real, explicit labels — see `handleVoiceOfCustomer`'s own `VOC_THEMES` for the keyword lists behind each one. */
const THEME_LABELS: Record<string, string> = {
  personal_warmth: 'Personal warmth & welcome',
  listening_consultation: 'Listening & consultation quality',
  result_quality: 'Result quality',
  stylist_loyalty: 'Loyalty to a specific stylist',
  value_price: 'Value & pricing',
  wait_time: 'Wait time & punctuality',
  cleanliness: 'Cleanliness',
};

export function labelForVocTheme(theme: string): string {
  return THEME_LABELS[theme] ?? theme;
}
