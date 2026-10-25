/** Downloaded media are served next to the default bundle (nginx in Docker, the Vite middleware in dev). */
export const MEDIA_BASE = 'data/media/';

export function mediaUrl(file: string): string {
  return MEDIA_BASE + encodeURIComponent(file);
}
