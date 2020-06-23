# IOT 

This project is a fork of [Thingsboard v3.0.1](https://github.com/thingsboard/thingsboard/tree/v3.0.1)

To setup and run this project, refer to the [Contribution Guide](https://thingsboard.io/docs/user-guide/contribution/how-to-contribute) or to the `README.md` file in the `/docker` folder (PREFERRED)

## TL;DR

### Using local sources

Commands to launch without consulting Contribution Guide, this method run the server and the client from local source:

1. In the root directory launch `mvn clean install -DskipTests`
2. Go to the `application` folder and launch `mvn clean install -DskipTests`
3. Once Maven has finished doing its stuffs, go to `/application/target/bin/install`, change file permission to file `install_dev_db.sh` by launching the command `chmod +x install_dev_db.sh` and execute it by `./install_dev_db.sh`. This file load the demo db with built-in users and devices
4. To start up client, go to `/ui` directory and launch `mvn clean install -P npm-start` (errors on the `*-css-plugin` in the console are not too relevant)
5. To start up the server, from the `root` folder, launch `java -jar application/target/thingsboard-2.5.0-boot.jar`
6. Once the client has started, navigate to `localhost:3000` and authenticate with one of the provided credentials

### Using docker images (PREFERRED)

Commands to launch without reading the `README.md` file inside the `/docker` folder:

1. Navigate to the `/docker` directory and run `./docker-create-log-folders.sh`
2. Run `./docker-install-tb.sh --loadDemo`, to create the postgres service with demo data. This action has to be performed the first time and eventually when you want to return the application to a state of fresh new start. But in order to do that, first the folders `log` and `postgres` in `/docker/tb-node` have to be deleted
3. Now everything is ready to startup all the services by running `./docker-start-services.sh` (To stop all the services run `./docker-stop-services.sh`, while `./docker-remove-services.sh` gets rid of volumes too)
4. Once all services are up, navigate to `localhost` and authenticate with one of the provided credentials

### Credentials

#### Thingsboard

- System administrator: `sysadmin@thingsboard.org` / `sysadmin`
- Tenant administrator: `tenant@thingsboard.org` / `tenant`
- Customer user: `custore@thingsboard.org` / `customer`

#### Keycloak

- Test user: test/test

**NOTE**

- currently this fork uses **HSQLDB** when running the application using local sources, and **POSTGRES** when running docker, so you won't need to setup any external database
- on client startup it may give errors on `node-sass`: stop the execution and launch the command `npm rebuild node-sass`, then restart client
- An OAuth2 authentication service, Keycloak, runs in the `Docker mode`, so when using local resources there won't be an extnernal OAuth2 authentication service enabled

