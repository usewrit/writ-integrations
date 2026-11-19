import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class WritApi implements ICredentialType {
	name = 'writApi';

	displayName = 'Writ API';

	icon: Icon = { light: 'file:../icons/writ.svg', dark: 'file:../icons/writ.dark.svg' };

	documentationUrl = 'https://github.com/usewrit/writ-integrations/tree/main/n8n#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'wt_...',
			description:
				'Create one in Writ under Developers, API keys. Give it the scopes for what this n8n instance should do.',
		},
		{
			displayName: 'API URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://api.usewrit.app',
			description: 'Leave as is unless Writ support gave you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/api/auth/me',
			method: 'GET',
		},
	};
}
