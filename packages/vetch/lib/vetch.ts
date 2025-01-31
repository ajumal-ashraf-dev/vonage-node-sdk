import fetch, { Response as fetchResponse, options } from 'node-fetch';
import { stringify } from 'querystring';
import merge from 'lodash.merge';
import http from 'http';
import https from 'https';
import { VetchError } from './types/vetchError';
import { Headers } from './interfaces/headers';
import { VetchResponse } from './interfaces/vetchResponse';
import { ResponseTypes } from './enums/responseTypes';
import { VetchOptions } from './interfaces/vetchOptions';
import debug from 'debug';

const log = debug('vonage:vetch');

export class Vetch {
  defaults: VetchOptions;

  constructor(defaults?: VetchOptions) {
    this.defaults = defaults || { responseType: ResponseTypes.json };
    if (!this.defaults.responseType) {
      this.defaults.responseType = ResponseTypes.json;
    }
  }

  private async _defaultAdapter<T>(
    opts: VetchOptions,
  ): Promise<VetchResponse<T>> {
    const { timeout } = opts;
    let timeoutId = null;
    const fetchConfig: options = opts;
    if (timeout) {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeout);
      fetchConfig.signal = controller.signal;
    }

    try {
      const res = await fetch(opts.url, fetchConfig);
      const data = await this.getResponseData(opts, res);
      return this.createResponse(opts, res, data);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async request<T>(opts: VetchOptions = {}): Promise<VetchResponse<T>> {
    opts = this.validateOpts(opts);

    log('api request', opts);

    const formattedResponse = await this._defaultAdapter<T>(opts);

    log('api response', formattedResponse);
    if (!opts.checkStatus(formattedResponse.status)) {
      const err = new VetchError(
        `Request failed with status code ${formattedResponse.status}`,
        opts,
      );
      err.code = String(formattedResponse.status);
      err.response = formattedResponse;
      throw err;
    }

    return formattedResponse;
  }

  private async getResponseData(
    opts: VetchOptions,
    res: fetchResponse,
  ): Promise<any> {
    switch (opts.responseType) {
    case 'stream':
      return res.buffer();
    case 'json': {
      let data = await res.text();
      try {
        data = JSON.parse(data);
      } catch {
        // continue
      }
      return data;
    }
    default:
      return res.text();
    }
  }

  private validateOpts(options: VetchOptions): VetchOptions {
    const opts = merge({}, this.defaults, options);

    opts.headers = opts.headers || {};
    opts.checkStatus = this.checkStatus;

    if (!opts.url) {
      throw new Error('URL is required.');
    }

    const baseUrl = opts.baseUrl || opts.baseURL;
    if (baseUrl) {
      opts.url = baseUrl + opts.url;
    }

    if (opts.params) {
      let queryParams = stringify(opts.params);
      if (queryParams.startsWith('?')) {
        queryParams = queryParams.slice(1);
      }

      const prefix = opts.url.includes('?') ? '&' : '?';
      opts.url = `${opts.url}${prefix}${queryParams}`;
    }

    if (opts.data) {
      if (typeof opts.data === 'object') {
        opts.body = JSON.stringify(opts.data);
        opts.headers['Content-Type'] = 'application/json';
      } else {
        opts.body = opts.data;
      }
    }

    if (!opts.headers.Accept && opts.responseType === 'json') {
      opts.headers.Accept = 'application/json';
    }

    // Set our user agent
    opts.headers['user-agent'] = [
      `@vonage/server-sdk/3.0.0`,
      ` node/${process.version.replace('v', '')}`,
      opts.appendUserAgent ? ` ${opts.appendUserAgent}` : '',
    ].join('');

    // Allow a custom timeout to be used
    const httpAgent = new http.Agent({
      timeout: opts.timeout,
    });
    const httpsAgent = new https.Agent({
      timeout: opts.timeout,
    });
    opts.agent = (parsedUrl: URL): https.Agent | http.Agent => {
      if (parsedUrl.protocol === 'http:') {
        return httpAgent;
      } else {
        return httpsAgent;
      }
    };

    return opts;
  }

  private checkStatus(status: number) {
    return status >= 200 && status < 300;
  }

  private createResponse<T>(
    opts: VetchOptions,
    res: fetchResponse,
    data?: T,
  ): VetchResponse<T> {
    const headers = {} as Headers;

    res.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      config: opts,
      data: data as T,
      headers,
      status: res.status,
      statusText: res.statusText,
      request: {
        responseUrl: res.url,
      },
    };
  }
}
