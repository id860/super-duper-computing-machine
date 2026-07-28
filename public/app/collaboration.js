import { api } from './api.js';
export const collaboration = {
	listTemplates: (worldId) => api.get(`/api/worlds/${encodeURIComponent(worldId)}/templates`),
	saveTemplate: (worldId, template) => api.post(`/api/worlds/${encodeURIComponent(worldId)}/templates`, template),
	listSubscriptions: (worldId) => api.get(`/api/worlds/${encodeURIComponent(worldId)}/subscriptions`),
	saveSubscription: (worldId, subscription) => api.post(`/api/worlds/${encodeURIComponent(worldId)}/subscriptions`, subscription)
};
