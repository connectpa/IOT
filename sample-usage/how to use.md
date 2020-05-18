# How to test iframe usage

Once the server is up and running, so as the client, login in incognito mode, copy the value of `jwt_token` in the `Application -> Local storage -> http://localhost:3000` panel of dev tools, and place it in the `index.html` in the `src` attribute of the `<iframe>` tag.

Then open it in the browser and... :tada:.  

## If service has been started with Docker

In the `index.html` file, remove the reference to the port in the `src` attribute, so `http://localhost:3000` becomes `http://localhost`. 