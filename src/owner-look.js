// The owner's look: the options shown in the creator and the default. Plain
// data, shared by every view.

export const SKIN_TONES = ['#f6d8c4', '#eabf9b', '#d19a70', '#a96f48', '#7b4b2f', '#523221'];
export const HAIR_COLORS = [
  { id: 'black', name: 'Black', hex: '#201a17' },
  { id: 'brown', name: 'Brown', hex: '#5b3a22' },
  { id: 'chestnut', name: 'Chestnut', hex: '#9a5a2e' },
  { id: 'blonde', name: 'Blonde', hex: '#e2c07a' },
  { id: 'red', name: 'Red', hex: '#b6462b' },
  { id: 'grey', name: 'Grey', hex: '#a3a7ad' },
  { id: 'blue', name: 'Blue', hex: '#3f6fd0' },
];
export const HAIR_STYLES = [
  { id: 'short', name: 'Short' },
  { id: 'long', name: 'Long' },
  { id: 'bun', name: 'Bun' },
  { id: 'curly', name: 'Curly' },
  { id: 'buzz', name: 'Buzzed' },
];
export const TOP_COLORS = ['#2f6f9f', '#c4473a', '#e2b33c', '#3e8a5c', '#7a5bb0', '#f2efe8', '#2b2b2e'];
export const BOTTOM_COLORS = ['#2f3b55', '#5b4636', '#77808c', '#c9b48e', '#1e1e22', '#6d8f5a'];

export function defaultOwner() {
  return { skin: SKIN_TONES[1], hair: 'short', hairColor: '#5b3a22', top: '#2f6f9f', bottom: '#2f3b55' };
}
