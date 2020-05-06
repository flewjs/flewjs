import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { ReativeModule, StateModule } from '@reative/angular';
import { NgxsModule } from '@ngxs/store';
import { environment } from '../environments/environment';
export function someReducer(state = 0, action) {
  switch (action.type) {
    case 'INCREMENT':
      return state + 1;
    case 'DECREMENT':
      return state - 1;
    default:
      return state;
  }
}

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    ReativeModule.forRoot({
      silent: false,
      baseURL: 'https://jsonplaceholder.typicode.com'
    }),
    StateModule.forRoot({ production: false, trace: true })
    // StoreModule.forRoot({
    //   production: false,
    //   reducers: { someReducer },
    //   initialState: { someReducer: 32535 }
    // }),
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}
