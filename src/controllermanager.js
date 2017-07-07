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

import Promise from '../bower_components/core.js/library/fn/promise';
import Set from'../bower_components/core.js/library/fn/set';
import {exists} from './utils';
import {checkMethod} from './utils';
import {checkParam} from './utils';

import ControllerProxy from './controllerproxy.js';

import CommandFactory from './commands/commandFactory.js';


import { SOURCE_SYSTEM } from './connector.js';
import { SOURCE_SYSTEM_CLIENT } from './connector.js';
import { ACTION_CALL_BEAN } from './connector.js';

const CONTROLLER_ID = 'controllerId';
const MODEL = 'model';
const ERROR_CODE = 'errorCode';

export default class ControllerManager{

    constructor(dolphin, classRepository, connector){
        checkMethod('ControllerManager(dolphin, classRepository, connector)');
        checkParam(dolphin, 'dolphin');
        checkParam(classRepository, 'classRepository');
        checkParam(connector, 'connector');

        this.dolphin = dolphin;
        this.classRepository = classRepository;
        this.connector = connector;
        this.controllers = new Set();
    }

    createController(name) {
        return this._createController(name, null)
    }

    _createController(name, parentControllerId) {
        checkMethod('ControllerManager.createController(name)');
        checkParam(name, 'name');

        let self = this;
        let controllerId, modelId, model, controller;
        return new Promise((resolve) => {
            self.connector.getHighlanderPM().then((highlanderPM) => {
                self.connector.invoke(CommandFactory.createCreateControllerCommand(name, parentControllerId)).then(() => {
                    controllerId = highlanderPM.findAttributeByPropertyName(CONTROLLER_ID).getValue();
                    modelId = highlanderPM.findAttributeByPropertyName(MODEL).getValue();
                    model = self.classRepository.mapDolphinToBean(modelId);
                    controller = new ControllerProxy(controllerId, model, self);
                    self.controllers.add(controller);
                    resolve(controller);
                });
            });
        });
    }

    invokeAction(controllerId, actionName, params) {
        checkMethod('ControllerManager.invokeAction(controllerId, actionName, params)');
        checkParam(controllerId, 'controllerId');
        checkParam(actionName, 'actionName');

        let self = this;
        return new Promise((resolve, reject) =>{

            let attributes = [
                self.dolphin.attribute(SOURCE_SYSTEM, null, SOURCE_SYSTEM_CLIENT),
                self.dolphin.attribute(ERROR_CODE)
            ];

            let pm = self.dolphin.presentationModel.apply(self.dolphin, [null, ACTION_CALL_BEAN].concat(attributes));

            let actionParams = [];
            if(exists(params)) {
                for (var param in params) {
                    if (params.hasOwnProperty(param)) {
                        let value = self.classRepository.mapParamToDolphin(params[param]);
                        actionParams.push({n: param, v: value});
                    }
                }
            }

            self.connector.invoke(CommandFactory.createCallActionCommand(controllerId, actionName, actionParams)).then(() => {
                let isError = pm.findAttributeByPropertyName(ERROR_CODE).getValue();
                if (isError) {
                    reject(new Error("ControllerAction caused an error"));
                } else {
                    resolve();
                }
                self.dolphin.deletePresentationModel(pm);
            });
        });
    }

    destroyController(controller) {
        checkMethod('ControllerManager.destroyController(controller)');
        checkParam(controller, 'controller');

        let self = this;
        return new Promise((resolve) => {
            self.connector.getHighlanderPM().then((highlanderPM) => {
                self.controllers.delete(controller);
                highlanderPM.findAttributeByPropertyName(CONTROLLER_ID).setValue(controller.controllerId);
                self.connector.invoke(CommandFactory.createDestroyControllerCommand(controller.getId())).then(resolve);
            });
        });
    }

    destroy() {
        let controllersCopy = this.controllers;
        let promises = [];
        this.controllers = new Set();
        controllersCopy.forEach((controller) => {
            try {
                promises.push(controller.destroy());
            } catch (e) {
                // ignore
            }
        });
        return Promise.all(promises);
    }
}
