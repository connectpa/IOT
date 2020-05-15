# Kubernetes resources configuration for ThingsBoard Microservices

This folder containing scripts and Kubernetes resources configurations to run ThingsBoard in Microservices mode.

## Prerequisites

ThingsBoard Microservices are running on Kubernetes cluster.
You need to have a Kubernetes cluster, and the kubectl command-line tool must be configured to communicate with your cluster.
If you do not already have a cluster, you can create one by using [Minikube](https://kubernetes.io/docs/setup/minikube), 
or you can choose any other available [Kubernetes cluster deployment solutions](https://kubernetes.io/docs/setup/pick-right-solution/).

### Enable ingress addon

By default ingress addon is disable in the Minikube, and available only in cluster providers.
To enable ingress, please execute next command:

`
$ minikube addons enable ingress
` 

## Installation

Before performing initial installation you can configure the type of database to be used with ThingsBoard.
In order to set database type change the value of `DATABASE` variable in `.env` file to one of the following:

- `postgres` - use PostgreSQL database;
- `cassandra` - use Cassandra database;

**NOTE**: According to the database type corresponding kubernetes resources will be deployed (see `postgres.yml`, `cassandra.yml` for details).

Execute the following command to run installation:

`
$ ./k8s-install-tb.sh --loadDemo
`

Where:

- `--loadDemo` - optional argument. Whether to load additional demo data.

## Running

Execute the following command to deploy thirdparty resources:

`
$ ./k8s-deploy-thirdparty.sh
`

Get list of the running tb-redis pods and verify that all of them are in running state:

`
$ kubectl get pods -l app=tb-redis
`

Execute the following command to create redis cluster:

`
$ kubectl exec -it tb-redis-0 -- redis-cli --cluster create --cluster-replicas 1 $(kubectl get pods -l app=tb-redis -o jsonpath='{range.items[*]}{.status.podIP}:6379 ')
`

Type **'yes'** when prompted.

Execute the following command to deploy resources:

`
$ ./k8s-deploy-resources.sh
`

After a while when all resources will be successfully started you can open `http://{your-cluster-ip}` in you browser (for ex. `http://192.168.99.101`).
You should see ThingsBoard login page.

Use the following default credentials:

- **System Administrator**: sysadmin@thingsboard.org / sysadmin

If you installed DataBase with demo data (using `--loadDemo` flag) you can also use the following credentials:

- **Tenant Administrator**: tenant@thingsboard.org / tenant
- **Customer User**: customer@thingsboard.org / customer

In case of any issues you can examine service logs for errors.
For example to see ThingsBoard node logs execute the following commands:

1) Get list of the running tb-node pods:

`
$ kubectl get pods -l app=tb-node
`

2) Fetch logs of tb-node pod:

`
$ kubectl logs -f [tb-node-pod-name]
`

Where:

- `tb-node-pod-name` - tb-node pod name obtained from the list of the running tb-node pods.

Or use `kubectl get pods` to see the state of all the pods.
Or use `kubectl get services` to see the state of all the services.
Or use `kubectl get deployments` to see the state of all the deployments.
See [kubectl Cheat Sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/) command reference for details.

Execute the following command to delete all deployed microservices:

`
$ ./k8s-delete-resources.sh
`

Execute the following command to delete all resources (including database):

`
$ ./k8s-delete-all.sh
`

## Upgrading

In case when database upgrade is needed, execute the following commands:

```
$ ./k8s-delete-resources.sh
$ ./k8s-upgrade-tb.sh --fromVersion=[FROM_VERSION]
$ ./k8s-deploy-resources.sh
```

Where:

- `FROM_VERSION` - from which version upgrade should be started. See [Upgrade Instructions](https://thingsboard.io/docs/user-guide/install/upgrade-instructions) for valid `fromVersion` values.
