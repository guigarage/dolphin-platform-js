import Emitter from 'emitter-component';


import { exists } from './utils';
import { DolphinRemotingError, HttpNetworkError, DolphinSessionError, HttpResponseError } from './errors';
import Codec from './commands/codec';
import RemotingErrorHandler from './remotingErrorHandler';
import {LoggerFactory} from './logger';

const FINISHED = 4;
const SUCCESS = 200;
const REQUEST_TIMEOUT = 408;

const DOLPHIN_PLATFORM_PREFIX = 'dolphin_platform_intern_';
const CLIENT_ID_HTTP_HEADER_NAME = DOLPHIN_PLATFORM_PREFIX + 'dolphinClientId';

export default class PlatformHttpTransmitter {

    constructor(url, config) {
        this.logger = LoggerFactory.getLogger('PlatformHttpTransmitter');

        this.url = url;
        this.config = config;
        this.headersInfo = exists(config) ? config.headersInfo : null;
        let connectionConfig = exists(config) ? config.connection : null;
        this.maxRetry = exists(connectionConfig) && exists(connectionConfig.maxRetry)?connectionConfig.maxRetry: 3;
        this.timeout = exists(connectionConfig) && exists(connectionConfig.timeout)?connectionConfig.timeout: 5000;
        this.failed_attempt = 0;
    }

    _handleError(reject, error) {
        let connectionConfig = exists(this.config) ? this.config.connection : null;
        let errorHandlers = exists(connectionConfig) && exists(connectionConfig.errorHandlers)?connectionConfig.errorHandlers: [new RemotingErrorHandler()];
        errorHandlers.forEach(function(handler) {
            handler.onError(error);
        });
        reject(error);
    }

    _send(commands) {
        return new Promise((resolve, reject) => {
            const http = new XMLHttpRequest();
            http.withCredentials = true;
            http.onerror = (errorContent) => {
                this._handleError(reject, new HttpNetworkError('PlatformHttpTransmitter: Network error', errorContent));
            };

            http.onreadystatechange = () => {
                if (http.readyState === FINISHED){
                    this.logger.trace('onreadystatechange', http);
                    switch (http.status) {

                        case SUCCESS:
                        {
                            this.failed_attempt = 0;
                            const currentClientId = http.getResponseHeader(CLIENT_ID_HTTP_HEADER_NAME);
                            if (exists(currentClientId)) {
                                if (exists(this.clientId) && this.clientId !== currentClientId) {
                                    this._handleError(reject, new DolphinSessionError('PlatformHttpTransmitter: ClientId of the response did not match'));
                                }
                                this.clientId = currentClientId;
                            } else {
                                this._handleError(reject, new DolphinSessionError('PlatformHttpTransmitter: Server did not send a clientId'));
                            }
                            resolve(http.responseText);
                            break;
                        }

                        case REQUEST_TIMEOUT:
                            this._handleError(reject, new DolphinSessionError('PlatformHttpTransmitter: Session Timeout'));
                            break;

                        default:
                            if(this.failed_attempt <= this.maxRetry){
                                this.failed_attempt = this.failed_attempt + 1;
                            }
                            this._handleError(reject, new HttpResponseError('PlatformHttpTransmitter: HTTP Status != 200 (' + http.status + ')'));
                            break;
                    }
                }
            };

            http.open('POST', this.url);
            if (exists(this.clientId)) {
                http.setRequestHeader(CLIENT_ID_HTTP_HEADER_NAME, this.clientId);
            }

            if (exists(this.headersInfo)) {
                for (let i in this.headersInfo) {
                    if (this.headersInfo.hasOwnProperty(i)) {
                        http.setRequestHeader(i, this.headersInfo[i]);
                    }
                }
            }
            let encodedCommands = Codec.encode(commands);
            if (this.failed_attempt > this.maxRetry) {
                setTimeout(function() {
                    this.logger.trace('_send', commands, encodedCommands);
                    http.send(encodedCommands);
                }, this.timeout);
            }else{
                this.logger.trace('_send', commands, encodedCommands);
                http.send(encodedCommands);
            }

        });
    }

    transmit(commands, onDone) {
        this._send(commands)
            .then(responseText => {
                if (responseText.trim().length > 0) {
                    try {
                        const responseCommands = Codec.decode(responseText);
                        onDone(responseCommands);
                    } catch (err) {
                        this.emit('error', new DolphinRemotingError('PlatformHttpTransmitter: Parse error: (Incorrect response = ' + responseText + ')'));
                        onDone([]);
                    }
                } else {
                    this.emit('error', new DolphinRemotingError('PlatformHttpTransmitter: Empty response'));
                    onDone([]);
                }
            })
            .catch(error => {
                this.emit('error', error);
                onDone([]);
            });
    }

    signal(command) {
        this._send([command])
            .catch(error => this.emit('error', error));
    }
}

Emitter(PlatformHttpTransmitter.prototype);
