// The browser talks to the Studio API through the shared typed client. No token and no base URL: the page is
// same-origin and authenticated by the HttpOnly session cookie set at /auth.
import { StudioClient } from '@mindmeld/client';

export const api = new StudioClient();
