/** A phone has a shorter screen side under 600 CSS pixels; a narrow window on a laptop is not one. */
export function isPhoneScreen(screen: { width: number; height: number }): boolean {
  return Math.min(screen.width, screen.height) < 600;
}
