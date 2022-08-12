import { guid, namespace, subscribe } from '@flew/core';
import {
  FlewDriver,
  FlewChainPayload,
  FlewDriverOption,
  FlewOptions,
  FlewVerb,
  FlewChain,
  Logger,
} from '@flew/core';
import { isEmpty, isFunction, trim, omit } from 'lodash';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { transpileChainQuery } from '../effects/transpile';
import { where } from '../effects/where';
import { order } from '../effects/order';
import { limit } from '../effects/limit';
import { skip } from '../effects/skip';
import { find } from '../effects/find';
import { select } from '../effects/select';
import { ParseOptions } from '../structure/options';

const workspace = namespace();

export class ParseDriver implements FlewDriver {
  options: Partial<ParseOptions>;
  instance: any; // parse instance
  driverName: FlewDriverOption = 'parse';
  driverOptions: FlewOptions = {};
  connector: any;
  logger: Logger;
  skipOnQuery = ['aggregate'];
  skipOnOperator = ['include', 'exclude'];
  specialOperators = ['or', 'and'];

  //
  // verbs tree
  public verbs: { [key in FlewVerb]: string | boolean } = {
    find: true,
    findOne: true,
    on: true,
    get: 'parse.find',
    post: 'parse.find',
    update: 'parse.update',
    patch: 'parse.update',
    put: 'parse.update',
    delete: true,
    set: true,
    count: true,
    run: true,
  };

  //
  // chaining tree
  public chaining: { [key in FlewChain]: string | boolean } = {
    from: true,
    network: true,
    key: true,
    query: true,
    where: true,
    sort: true,
    size: true,
    at: false,
    after: true,
    ref: false,
    http: false,
    include: true,
    doc: true,
    master: true,
    token: true,
    object: true,
    cache: 'browser',
    select: true,
    state: true,
    near: true,
    withinKilometers: true,
    withinMiles: true,
    diff: true,
    response: true,
    context: true,
  };

  constructor(options: ParseOptions) {
    this.options = omit(options, ['instance']);
    this.instance = options.instance;
  }

  configure(driverOptions: FlewOptions) {
    this.driverOptions = driverOptions;
    this.logger = driverOptions.logger;
    return this.getInstance();
  }

  public getInstance() {
    return this.instance;
  }

  public log() {
    return this.logger;
  }

  public find<T>(
    chain: FlewChainPayload,
    key: string,
    method = 'find',
  ): Observable<T[]> {
    return new Observable(observer => {
      //
      // network handle
      const error = err => {
        observer.error(err);
        observer.complete();
      };

      const success = (r: any) => {
        const response: T[] = [];
        if (method === 'find') {
          for (const item of r) {
            // tslint:disable-next-line: deprecation
            const entry =
              isFunction(item.toJSON) && !chain.useObject
                ? item.toJSON()
                : item;
            if (!chain.useObject) {
              entry.id = entry.objectId;
            }
            response.push(entry);
          }
        }

        observer.next(method === 'find' ? response : r);
        observer.complete();
      };

      find({
        Parse: this.getInstance(),
        chain: chain,
        collection: this.getCollectionName(),
        skipOnQuery: this.skipOnQuery,
        skipOnOperator: this.skipOnOperator,
        specialOperators: this.specialOperators,
        success: r => success(r),
        error: err => error(err),
        method,
      });
    });
  }

  public findOne<T>(chain: FlewChainPayload, key: string): Observable<T> {
    chain.size = 1;
    return this.find<T>(chain, key).pipe(
      map(r => (r && r.length ? r[0] : ({} as T))),
    );
  }

  public on<T>(
    chain: FlewChainPayload,
    key: string,
    options?: { debounceTime?: number },
  ): Observable<T> {
    return new Observable(observer => {
      const Parse = this.getInstance();

      workspace.calls[key] = new Parse.Query(this.getCollectionName());

      //
      // Transpile chain query
      const specialQueries: any = transpileChainQuery(chain.query, {
        Parse: this.getInstance(),
        chain: chain,
        collection: this.getCollectionName(),
        skipOnQuery: this.skipOnQuery,
        skipOnOperator: this.skipOnOperator,
        specialOperators: this.specialOperators,
      });

      //
      // Join query with connector
      if (!isEmpty(specialQueries) && this.isSpecialQuery(chain)) {
        workspace.calls[key] = Parse.Query.and(...specialQueries);
      } else {
        for (const q in chain.query) {
          if (isFunction(chain.query[q])) {
            workspace.calls[key][q](...chain.query[q]());
          } else {
            workspace.calls[key][q](...chain.query[q]);
          }
        }
      }

      //
      // set where
      where(chain.where, workspace.calls[key]);

      //
      // set order
      order(chain.sort, workspace.calls[key]);

      //
      // set limit
      if (chain.size) limit(chain.size, workspace.calls[key]);

      //
      // set include (pointers, relation, etc)
      if (chain.fields) {
        workspace.calls[key].include(chain.fields);
      }

      if (chain.query && chain.query.include) {
        workspace.calls[key].include(chain.query.include);
      }

      //
      // set skip
      if (chain.after) skip(chain.after, workspace.calls[key]);

      //
      // set select
      if (chain.select) select(chain.select, workspace.calls[key]);

      //
      // fire in the hole
      const getData = async (result?) => {
        if (isEmpty(result)) {
          result = [];
          const entries: any[] = await workspace.calls[key].find({
            useMasterKey: chain.useMasterKey,
            sessionToken: chain.useSessionToken,
          });
          for (const item of entries) {
            // tslint:disable-next-line: deprecation
            const entry = isFunction(item.toJSON) ? item.toJSON() : item;
            entry.id = entry.objectId;
            result.push(entry);
          }
        } else {
          result = [result];
        }
        //
        // define standard response
        return result;
      };

      workspace.calls[key].subscribe().then(async handler => {
        let lastTimeChecked = new Date().getTime();
        observer.next((await getData()) as T);

        handler.on('create', async object => {
          var lastTimeCheckedDue =
            new Date().getTime() >
            (lastTimeChecked + options?.debounceTime || 0);
          if (lastTimeCheckedDue) {
            lastTimeChecked = new Date().getTime();
            observer.next((await getData()) as T);
          }
        });

        handler.on('update', async object => {
          var lastTimeCheckedDue =
            new Date().getTime() >
            (lastTimeChecked + options?.debounceTime || 0);
          if (lastTimeCheckedDue) {
            lastTimeChecked = new Date().getTime();
            observer.next((await getData()) as T);
          }
        });

        handler.on('delete', async object => {
          var lastTimeCheckedDue =
            new Date().getTime() >
            (lastTimeChecked + options?.debounceTime || 0);
          if (lastTimeCheckedDue) {
            lastTimeChecked = new Date().getTime();
            observer.next((await getData()) as T);
          }
        });

        handler.on('close', () => {
          observer.complete();
        });

        const internalHandler = subscribe(`flew-${key}`, () => {
          handler.unsubscribe();
          internalHandler.unsubscribe();
        });
      });
    });
  }

  public set(
    chain: FlewChainPayload,
    data: any,
    options = { all: false },
  ): Observable<any> {
    return new Observable(observer => {
      const Parse = this.getInstance();

      const response = r => {
        observer.next(r);
        observer.complete();
      };

      const error = err => {
        observer.error(err);
        observer.complete();
      };

      if (!options.all) {
        const connector = new Parse.Object(this.getCollectionName());
        // const id = chain.doc || data[this.driverOptions.identifier];
        const newData = { ...data };

        //
        // auto id generation
        if (!this.driverOptions.disableAutoID) {
          if (!newData[this.driverOptions.identifier])
            newData[this.driverOptions.identifier] = guid();
        }

        //
        // auto update timestamp
        if (this.driverOptions.timestampEnabled !== false) {
          const timestamp = this.driverOptions.timestampObject
            ? new Date()
            : new Date().toISOString();
          if (!newData[this.driverOptions.timestampCreated]) {
            newData[this.driverOptions.timestampCreated] = timestamp;
          }
          if (!newData[this.driverOptions.timestampUpdated]) {
            newData[this.driverOptions.timestampUpdated] = timestamp;
          }
        }

        connector
          .save(newData, {
            useMasterKey: chain.useMasterKey,
            sessionToken: chain.useSessionToken,
            context: chain.context,
          })
          .then(response)
          .catch(error);
      } else {
        const connector = Parse.Object;
        connector
          .saveAll(data, {
            useMasterKey: chain.useMasterKey,
            sessionToken: chain.useSessionToken,
            context: chain.context,
          })
          .then(response)
          .catch(error);
      }
    });
  }

  public run(
    name: string,
    payload: any,
    key: string,
    chain: FlewChainPayload,
  ): Observable<any> {
    return new Observable(observer => {
      const Parse = this.getInstance();
      const context = chain.context;
      const useMasterKey = chain.useMasterKey;
      const sessionToken = chain.useSessionToken;

      //
      // define connector
      const cloud = Parse.Cloud;

      //
      // define return
      const response = r => {
        observer.next(r);
        observer.complete();
      };

      const error = err => {
        observer.error(err);
        observer.complete();
      };

      cloud
        .run(name, payload, { context, useMasterKey, sessionToken })
        .then(response)
        .catch(error);
    });
  }

  public update(chain: FlewChainPayload, data: any): Observable<any> {
    return new Observable(observer => {
      const Parse = this.getInstance();

      //
      // clone state
      const newData = { ...data };

      //
      // auto update timestamp
      if (this.driverOptions.timestampEnabled !== false) {
        if (!newData[this.driverOptions.timestampUpdated]) {
          newData[this.driverOptions.timestampUpdated] = this.driverOptions
            .timestampObject
            ? new Date()
            : new Date().toISOString();
        }
      }

      //
      // define return
      const response = r => {
        observer.next(newData);
        observer.complete();
      };
      const error = err => {
        observer.error(err);
        observer.complete();
      };

      //
      // persist on cloud
      const id1 = new Parse.Query(this.getCollectionName());
      id1.equalTo('objectId', chain.doc);

      const id2 = new Parse.Query(this.getCollectionName());
      id2.equalTo(this.driverOptions.identifier, chain.doc);

      Parse.Query.or(id1, id2)
        .find({
          useMasterKey: chain.useMasterKey,
          sessionToken: chain.useSessionToken,
        })
        .then((r: any[] = []) => {
          if (r.length) {
            for (const k in data) {
              r[0].set(k, data[k]);
            }
            r[0]
              .save(null, {
                useMasterKey: chain.useMasterKey,
                sessionToken: chain.useSessionToken,
                context: chain.context,
              })
              .then(response)
              .catch(error);
          }
        });
    });
  }

  public count<T>(chain: FlewChainPayload, key: string): Observable<any> {
    return this.find<T>(chain, key, 'count');
  }

  public delete<T>(
    path: string,
    key: string,
    payload: any,
    chain: FlewChainPayload,
  ): Observable<T> {
    return new Observable(observer => {
      const Parse = this.getInstance();

      //
      // define adapter
      this.connector = new Parse.Query(this.getCollectionName());

      //
      // add or condition when doc is set
      if (chain.doc) {
        // console.log(this.driverOptions.identifier, trim(chain.doc));
        let orQueryExtended = {
          or: [
            {
              equalTo: () => [this.driverOptions.identifier, trim(chain.doc)],
            },
          ],
        };
        if (chain.query && chain.query.or) {
          orQueryExtended = {
            or: [...chain.query.or, ...orQueryExtended.or],
          };
        }
        chain.query = {
          ...chain.query,
          ...orQueryExtended,
        };
      }

      //
      // Transpile chain query
      const query: any = transpileChainQuery(chain.query, {
        Parse: this.getInstance(),
        chain: chain,
        collection: this.getCollectionName(),
        skipOnQuery: this.skipOnQuery,
        skipOnOperator: this.skipOnOperator,
        specialOperators: this.specialOperators,
      });

      //
      // Join query with connector
      if (!isEmpty(query)) this.connector = Parse.Query.and(...query);

      //
      // set where
      where(chain.where, this.connector);

      //
      // set skip
      if (chain.after) skip(chain.after, this.connector);

      //
      // network handle
      const error = err => {
        observer.error(err);
        observer.complete();
      };

      const success = async (data: any[]) => {
        if (isEmpty(data)) return error({ message: `data wasn't found` });

        const list = await Parse.Object.destroyAll(data, {
          context: chain.context,
        }).catch(err => {
          // An error occurred while deleting one or more of the objects.
          // If this is an aggregate error, then we can inspect each error
          // object individually to determine the reason why a particular
          // object was not deleted.
          if (err.code === Parse.Error.AGGREGATE_ERROR) {
            for (let i = 0; i < err.errors.length; i++) {
              const msg =
                "Couldn't delete " +
                err.errors[i].object.id +
                'due to ' +
                err.errors[i].message;
              console.log(msg);
            }
          } else {
            console.log('Delete aborted because of ' + err.message);
          }
          error(err);
        });

        //
        // success callback
        observer.next(list as T);
        observer.complete();
      };

      this.connector
        .find({
          useMasterKey: chain.useMasterKey,
          sessionToken: chain.useSessionToken,
        })
        .then(success)
        .catch(error);
    });
  }

  getCollectionName() {
    const mapping = {
      User: '_User',
      Role: '_Role',
      Session: '_Session',
      Installation: '_Installation',
    };
    const name = this.driverOptions.collection;
    return mapping[name] ? mapping[name] : name;
  }

  isSpecialQuery(chain: FlewChainPayload): boolean {
    const query = { ...chain.query };
    let isSpecial = false;
    for (const item in query) {
      if (this.specialOperators.includes(item)) {
        isSpecial = true;
      }
    }
    return isSpecial;
  }
}
