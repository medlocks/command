// Illustrative name pools for mock client/stylist generation only — not
// real people. See Requirements Section 3.1: real data arrives via Fresha
// upload once that adapter is live.

export const FIRST_NAMES = [
  'Olivia', 'Amelia', 'Isla', 'Ava', 'Freya', 'Ivy', 'Grace', 'Sophia', 'Lily', 'Poppy',
  'Charlotte', 'Emily', 'Jessica', 'Millie', 'Ruby', 'Elsie', 'Phoebe', 'Daisy', 'Evie', 'Rosie',
  'Chloe', 'Ella', 'Georgia', 'Hannah', 'Holly', 'Imogen', 'Jasmine', 'Katie', 'Layla', 'Maya',
  'Megan', 'Molly', 'Nancy', 'Niamh', 'Paige', 'Sienna', 'Summer', 'Tilly', 'Zara', 'Alice',
  'James', 'Oliver', 'Harry', 'George', 'Noah', 'Jack', 'Leo', 'Charlie', 'Freddie', 'Oscar',
  'Arthur', 'Henry', 'Thomas', 'Joshua', 'William', 'Alexander', 'Daniel', 'Lucas', 'Ethan', 'Mason',
] as const;

export const LAST_NAMES = [
  'Smith', 'Jones', 'Taylor', 'Williams', 'Brown', 'Davies', 'Evans', 'Wilson', 'Thomas', 'Roberts',
  'Johnson', 'Lewis', 'Walker', 'Robinson', 'Wood', 'Thompson', 'White', 'Watson', 'Jackson', 'Wright',
  'Green', 'Harris', 'Cooper', 'King', 'Lee', 'Baker', 'Hall', 'Clarke', 'James', 'Morgan',
  'Hughes', 'Edwards', 'Turner', 'Bell', 'Fisher', 'Ward', 'Reid', 'Cole', 'Murphy', 'Bailey',
] as const;

const STYLIST_FIRST_NAMES = [
  'Priya', 'Chloe', 'Amara', 'Isabelle', 'Kayleigh', 'Ffion', 'Beth', 'Nadia',
] as const;

export function stylistNames(): readonly string[] {
  return STYLIST_FIRST_NAMES;
}
