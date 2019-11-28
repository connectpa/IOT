# IOT 
This project is a fork of [Thingsboard v2.4.1](https://github.com/thingsboard/thingsboard/tree/v2.4.1).

To setup and run this project, refer to the [Contribution Guide](https://thingsboard.io/docs/user-guide/contribution/how-to-contribute).

## TL;DR

Commands to launch without consulting Contribution Guide:

1. In the root directory launch `mvn clean install -DskipTests`.

2. Once Maven has finished doing its stuffs, go to `./application/target/bin/install`, change file permission to file `install_dev_db.sh` by launching the command `chmod +x install_dev_db.sh` and execute it by `./install_dev_db.sh`. This file load the demo db with built-in users and devices.

3. To start up server, run the main method of `ThingsboardServerApplication` class that is located in `application/src/main/java/org.thingsboard.server`.

4. To start up client, go to `/ui` directory and launch `mvn clean install -P npm-start`.

5. Once the client has started, navigate to `localhost:3000` and authenticate with:

   *login* `tenant@thingsboard.org`

   *password* `tenant`

**NOTE**

- currently this fork uses **HSQLDB**, so you won't need to setup any external database.
- on client startup it may give errors on `node-sass`: stop the execution and launch the command `npm rebuild node-sass`, then restart client.

