# IOT 

This project is a fork of [Thingsboard v3.0.1](https://github.com/thingsboard/thingsboard/tree/v3.0.1)

To setup and run this project, follow this steps:

1. Navigate to the `/docker` directory and run `./docker-create-log-folders.sh`
2. Run `./docker-install-tb.sh --loadDemo`, to create the postgres service with demo data. This action has to be performed the first time and eventually when you want to return the application to a state of fresh new start. But in order to do that, first the folders `log` and `postgres` in `/docker/tb-node` have to be deleted
3. The service `oauth2-mapper` needs the docker image `psacr.azure.io/oauth2-mapper:latest`, which can be generated locally downloading the project [thingsboard-oauth2-mapper](https://github.com/connectpa/thingsboard-oauth2-mapper) and following the steps described there
4. Now everything is ready to startup all the services by running `./docker-start-services.sh` (To stop all the services run `./docker-stop-services.sh`, while `./docker-remove-services.sh` gets rid of volumes too)
5. Once all services are up, navigate to `localhost` and authenticate with one of the provided credentials

### Credentials

#### Thingsboard

- System administrator: `sysadmin@thingsboard.org` / `sysadmin`
- Tenant administrator: `tenant@thingsboard.org` / `tenant`
- Customer user: `custore@thingsboard.org` / `customer`

#### Keycloak

The are already some predefined users in the realm

- Test user: test/test
- Tenant user: tenant/tenant
- Customer user: customer/customer

The `Tenant` and `Customer` users have a `role` attribute, used by the `OAuth 2 mapper` to discriminate the type of user which will be created when that user will do the first login to the platform