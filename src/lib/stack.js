/* global __TARGET__ */
/* eslint-env browser */

import realtime from 'cozy-realtime'
import getIcon from './icon'

import {
  ForbiddenException,
  ServerErrorException,
  NotFoundException,
  MethodNotAllowedException,
  UnavailableStackException,
  UnavailableSettingsException,
  UnauthorizedStackException
} from './exceptions'

// the option credentials:include tells fetch to include the cookies in the
// request even for cross-origin requests
function fetchOptions() {
  return {
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${COZY_TOKEN}`,
      Accept: 'application/json'
    }
  }
}

let COZY_URL
let COZY_HOST
let COZY_TOKEN
let USE_SSL

const errorStatuses = {
  '401': UnauthorizedStackException,
  '403': ForbiddenException,
  '404': NotFoundException,
  '405': MethodNotAllowedException,
  '500': ServerErrorException
}

function getApps() {
  return fetchJSON(`${COZY_URL}/apps/`, fetchOptions()).then(json => {
    if (json.error) throw new Error(json.error)
    else return json.data
  })
}

function fetchJSON(url, options) {
  return fetch(url, options).then(res => {
    if (typeof errorStatuses[res.status] === 'function') {
      throw new errorStatuses[res.status]()
    }

    return res.json()
  })
}

// fetch function with the same interface than in cozy-client-js
function cozyFetchJSON(cozy, method, path, body) {
  const requestOptions = Object.assign({}, fetchOptions(), {
    method
  })
  requestOptions.headers['Accept'] = 'application/json'
  if (method !== 'GET' && method !== 'HEAD' && body !== undefined) {
    if (requestOptions.headers['Content-Type']) {
      requestOptions.body = body
    } else {
      requestOptions.headers['Content-Type'] = 'application/json'
      requestOptions.body = JSON.stringify(body)
    }
  }
  return fetchJSON(`${COZY_URL}${path}`, requestOptions).then(json => {
    const responseData = Object.assign({}, json.data)
    if (responseData.id) responseData._id = responseData.id
    return Promise.resolve(responseData)
  })
}

function getStorageData() {
  return fetchJSON(`${COZY_URL}/settings/disk-usage`, fetchOptions())
    .then(json => {
      return {
        usage: parseInt(json.data.attributes.used, 10),
        // TODO Better handling when no quota provided
        quota: parseInt(json.data.attributes.quota, 10) || 100000000000,
        isLimited: json.data.attributes.is_limited
      }
    })
    .catch(() => {
      throw new UnavailableStackException()
    })
}

function getContext(cache) {
  return () => {
    return cache['context']
      ? Promise.resolve(cache['context'])
      : fetchJSON(`${COZY_URL}/settings/context`, fetchOptions())
          .then(context => {
            cache['context'] = context
            return context
          })
          .catch(error => {
            if (error.status && error.status === 404) cache['context'] = {}
          })
  }
}

function getApp(slug) {
  if (!slug) {
    throw new Error('Missing slug')
  }
  return fetchJSON(`${COZY_URL}/apps/${slug}`, fetchOptions()).then(json => {
    if (json.error) throw new Error(json.error)
    else return json.data
  })
}

const cache = {}

const _fetchIcon = app => getIcon(COZY_URL, fetchOptions(), app, true)
export const getAppIconProps = () => {
  return __TARGET__ === 'mobile'
    ? { fetchIcon: _fetchIcon }
    : {
        // we mustn't give the protocol here
        domain: COZY_HOST,
        secure: USE_SSL
      }
}

async function initializeRealtime({ onCreateApp, onDeleteApp, url, token }) {
  const realtimeConfig = { token, url }

  try {
    realtime
      .subscribe(realtimeConfig, 'io.cozy.apps')
      .onCreate(async app => {
        // Fetch direclty the app to get attributes `related` as well.
        let fullApp
        try {
          fullApp = await getApp(app.slug)
        } catch (error) {
          throw new Error(`Cannont fetch app ${app.slug}: ${error.message}`)
        }

        if (typeof onCreateApp === 'function') {
          onCreateApp(fullApp)
        }
      })
      .onDelete(app => {
        if (typeof onDeleteApp === 'function') {
          onDeleteApp(app)
        }
      })
  } catch (error) {
    console.warn(`Cannot initialize realtime in Cozy-bar: ${error.message}`)
  }
}

const determineURL = (cozyURL, ssl) => {
  let url
  let host
  const protocol = ssl ? 'https' : 'http'

  try {
    // only on mobile we get the full URL with the protocol
    host = new URL(cozyURL).host
    url = !!host && `${protocol}://${host}`
  } catch (e) {} // eslint-disable-line no-empty

  host = host || cozyURL
  url = url || `${protocol}://${host}`

  return { COZY_URL: url, COZY_HOST: host }
}

module.exports = {
  async init({ cozyURL, token, onCreateApp, onDeleteApp, ssl }) {
    ;({ COZY_URL, COZY_HOST } = determineURL(cozyURL, ssl))
    COZY_TOKEN = token
    USE_SSL = ssl
    await initializeRealtime({
      onCreateApp,
      onDeleteApp,
      token: COZY_TOKEN,
      url: COZY_URL,
      ssl: USE_SSL
    })
  },
  updateAccessToken(token) {
    COZY_TOKEN = token
  },
  get: {
    app: getApp,
    apps: getApps,
    context: getContext(cache),
    storageData: getStorageData,
    iconProps: getAppIconProps,
    cozyURL() {
      return COZY_URL
    },
    settingsAppURL() {
      return getApp('settings').then(settings => {
        if (!settings) {
          throw new UnavailableSettingsException()
        }
        return settings.links.related
      })
    }
  },
  logout() {
    const options = Object.assign({}, fetchOptions(), {
      method: 'DELETE'
    })

    return fetch(`${COZY_URL}/auth/login`, options)
      .then(res => {
        if (res.status === 401) {
          throw new UnauthorizedStackException()
        } else if (res.status === 204) {
          window.location.reload()
        }
      })
      .catch(() => {
        throw new UnavailableStackException()
      })
  },
  cozyFetchJSON // used in intents library
}
