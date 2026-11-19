'use strict';

const { SCOPES, url } = require('./lib/config');

/**
 * OAuth 2.0 against Writ's own authorization server (authorization code with PKCE,
 * refresh tokens). Writ registers the Zapier client; its id and secret are the
 * CLIENT_ID / CLIENT_SECRET environment variables of the Zapier app.
 */
module.exports = {
  type: 'oauth2',
  oauth2Config: {
    authorizeUrl: {
      url: url('/api/oauth/authorize'),
      params: {
        client_id: '{{process.env.CLIENT_ID}}',
        state: '{{bundle.inputData.state}}',
        redirect_uri: '{{bundle.inputData.redirect_uri}}',
        response_type: 'code',
        scope: SCOPES.join(' '),
      },
    },
    getAccessToken: {
      url: url('/api/oauth/token'),
      method: 'POST',
      body: {
        code: '{{bundle.inputData.code}}',
        client_id: '{{process.env.CLIENT_ID}}',
        client_secret: '{{process.env.CLIENT_SECRET}}',
        redirect_uri: '{{bundle.inputData.redirect_uri}}',
        code_verifier: '{{bundle.inputData.code_verifier}}',
        grant_type: 'authorization_code',
      },
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    },
    refreshAccessToken: {
      url: url('/api/oauth/token'),
      method: 'POST',
      body: {
        refresh_token: '{{bundle.authData.refresh_token}}',
        client_id: '{{process.env.CLIENT_ID}}',
        client_secret: '{{process.env.CLIENT_SECRET}}',
        grant_type: 'refresh_token',
      },
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    },
    scope: SCOPES.join(' '),
    autoRefresh: true,
    enablePkce: true,
  },
  test: { url: url('/api/auth/me') },
  connectionLabel: '{{email}}',
};
