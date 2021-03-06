import {exists} from '../utils';
import { LoggerFactory } from '../logging';

class PlatformClient {

}

PlatformClient.LOGGER = LoggerFactory.getLogger('PlatformClient');

PlatformClient.services = new Map();
PlatformClient.serviceProviders = new Map();
PlatformClient.configuration = {};

PlatformClient.getService = function(name) {
    let service = PlatformClient.services.get(name);
    if (!exists(service)) {
        let provider = PlatformClient.serviceProviders.get(name);
        if (!exists(provider)) {
            throw new Error('No service provider found for ' + name);
        } else {
            service = provider.getService(PlatformClient.configuration);
            PlatformClient.services.set(name, service);
        }
    }
    return service;
};

PlatformClient.hasService = function(name) {
    const provider = PlatformClient.serviceProviders.get(name);
    if (!exists(provider)) {
        return false;
    } else {
        return true;
    }
};

PlatformClient.getAllServiceTypes = function() {
    let result = [];
    PlatformClient.serviceProviders.forEach((serviceProvider) => result.push(serviceProvider));
    return result;
};


PlatformClient.registerServiceProvider = function(serviceProvider) {
    if (serviceProvider === null || typeof serviceProvider === 'undefined') {
        throw new Error('Cannot register empty service provider');
    }
    
    if (typeof serviceProvider.getName === 'function' && typeof serviceProvider.getService === 'function') {
        const current = PlatformClient.serviceProviders.get(serviceProvider.getName());
        if (!current) {
            PlatformClient.serviceProviders.set(serviceProvider.getName(), serviceProvider);
            PlatformClient.LOGGER.debug('Service provider registered with name', serviceProvider.getName());
        } else {
            throw new Error('Cannot register another service provider. Name already in use.');
        }
    } else {
        throw new Error('Cannot register service provider without getName() and getService() methods');
    }
};

PlatformClient.init = function() {
    PlatformClient.serviceProviders.forEach((serviceProvider) => {
        const service = serviceProvider.getService();
        PlatformClient.LOGGER.trace('Initializing service for service provider', serviceProvider.getName());
        if (typeof service.initServiceProvider === 'function') {
            PlatformClient.LOGGER.debug('Initializing service', service);
            service.initServiceProvider(PlatformClient);
        }
    });
}

export { PlatformClient }