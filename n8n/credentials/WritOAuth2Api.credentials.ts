import type { ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

/**
 * OAuth2 against Writ's own authorization server. Create an OAuth app in Writ under
 * Integrations with this credential's OAuth Redirect URL, then paste its client id
 * and secret here. The scopes are the ones every Writ node operation needs; the
 * consent screen lists them before anything is granted.
 */
export class WritOAuth2Api implements ICredentialType {
	name = 'writOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Writ OAuth2 API';

	icon: Icon = { light: 'file:../icons/writ.svg', dark: 'file:../icons/writ.dark.svg' };

	documentationUrl = 'https://github.com/usewrit/writ-integrations/tree/main/n8n#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://api.usewrit.app',
			description: 'Leave as is unless Writ support gave you another address',
		},
		{
			displayName: 'Use Dynamic Client Registration',
			name: 'useDynamicClientRegistration',
			type: 'hidden',
			default: false,
		},
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'pkce',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: '={{$self["baseUrl"].replace(/\\/+$/, "")}}/api/oauth/authorize',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: '={{$self["baseUrl"].replace(/\\/+$/, "")}}/api/oauth/token',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default:
				'account:read workflows:read workflows:execute runs:read datasets:read scrape:execute crawl:read crawl:execute monitors:read monitors:write monitors:execute triggers:read triggers:write triggers:delete',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
	];
}
