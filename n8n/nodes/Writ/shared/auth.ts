import type { INodeCredentialDescription, INodeProperties } from 'n8n-workflow';

/** One credential at a time: an API key, or OAuth2 through an app made in Writ. */
export const authenticationProperty: INodeProperties = {
	displayName: 'Authentication',
	name: 'authentication',
	type: 'options',
	options: [
		{ name: 'API Key', value: 'apiKey' },
		{ name: 'OAuth2', value: 'oAuth2' },
	],
	default: 'apiKey',
};

export const credentialsDescription: INodeCredentialDescription[] = [
	{
		name: 'writApi',
		required: true,
		displayOptions: { show: { authentication: ['apiKey'] } },
	},
	{
		name: 'writOAuth2Api',
		required: true,
		displayOptions: { show: { authentication: ['oAuth2'] } },
	},
];
