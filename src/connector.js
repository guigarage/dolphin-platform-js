/* Copyright 2015 Canoo Engineering AG.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*jslint browserify: true */
/* global console */
"use strict";

import OpenDolphin from '../opendolphin/build/OpenDolphin.js';

import Promise from '../bower_components/core.js/library/fn/promise';
import ClientModelStore from '../opendolphin/build/ClientModelStore';
import {exists} from './utils.js';
import {checkMethod} from './utils';
import {checkParam} from './utils';

const DOLPHIN_BEAN = '@@@ DOLPHIN_BEAN @@@';
const ACTION_CALL_BEAN = '@@@ CONTROLLER_ACTION_CALL_BEAN @@@';
const HIGHLANDER_BEAN = '@@@ HIGHLANDER_BEAN @@@';
const DOLPHIN_LIST_SPLICE = '@DP:LS@';
const SOURCE_SYSTEM = '@@@ SOURCE_SYSTEM @@@';
const SOURCE_SYSTEM_CLIENT = 'client';
const SOURCE_SYSTEM_SERVER = 'server';

export default class Connector{

    constructor(url, dolphin, classRepository, config) {
        checkMethod('Connector(url, dolphin, classRepository, config)');
        checkParam(url, 'url');
        checkParam(dolphin, 'dolphin');
        checkParam(classRepository, 'classRepository');

        let self = this;
        this.dolphin = dolphin;
        this.config = config;
        this.classRepository = classRepository;
        this.highlanderPMResolver = function() {};
        this.highlanderPMPromise = new Promise(function(resolve) {
            self.highlanderPMResolver = resolve;
        });

        dolphin.getClientModelStore().onModelStoreChange((event) => {
            let model = event.clientPresentationModel;
            let sourceSystem = model.findAttributeByPropertyName(SOURCE_SYSTEM);
            if (exists(sourceSystem) && sourceSystem.value === SOURCE_SYSTEM_SERVER) {
                if (event.eventType === ClientModelStore.Type.ADDED) {
                    self.onModelAdded(model);
                } else if (event.eventType === ClientModelStore.Type.REMOVED) {
                    self.onModelRemoved(model);
                }
            }
        });
    }
    connect() {
        let that = this;
        setTimeout(() => {
            that.dolphin.startPushListening(OpenDolphin.createStartLongPollCommand(), OpenDolphin.createInterruptLongPollCommand());
        }, 0);
    }

    onModelAdded(model) {
        checkMethod('Connector.onModelAdded(model)');
        checkParam(model, 'model');

        var type = model.presentationModelType;
        switch (type) {
            case ACTION_CALL_BEAN:
                // ignore
                break;
            case DOLPHIN_BEAN:
                this.classRepository.registerClass(model);
                break;
            case HIGHLANDER_BEAN:
                this.highlanderPMResolver(model);
                break;
            case DOLPHIN_LIST_SPLICE:
                this.classRepository.spliceListEntry(model);
                this.dolphin.deletePresentationModel(model);
                break;
            default:
                this.classRepository.load(model);
                break;
        }
    }

    onModelRemoved(model) {
        checkMethod('Connector.onModelRemoved(model)');
        checkParam(model, 'model');

        let type = model.presentationModelType;
        switch (type) {
            case this.constructor.DOLPHIN_BEAN:
                this.classRepository.unregisterClass(model);
                break;
            case DOLPHIN_LIST_SPLICE:
                // do nothing
                break;
            default:
                this.classRepository.unload(model);
                break;
        }
    }

    invoke(command) {
        checkMethod('Connector.invoke(command)');
        checkParam(command, 'command');

        var dolphin = this.dolphin;
        return new Promise((resolve) => {
            dolphin.send(command, {
                onFinished: () => {
                    resolve();
                }
            });
        });
    }

    getHighlanderPM() {
        return this.highlanderPMPromise;
    }
}

exports.SOURCE_SYSTEM = SOURCE_SYSTEM;
exports.SOURCE_SYSTEM_CLIENT = SOURCE_SYSTEM_CLIENT;
exports.SOURCE_SYSTEM_SERVER = SOURCE_SYSTEM_SERVER;
exports.ACTION_CALL_BEAN = ACTION_CALL_BEAN;
