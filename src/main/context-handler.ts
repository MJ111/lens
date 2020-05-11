import { KubeConfig, CoreV1Api } from "@kubernetes/client-node"
import * as http from "http"
import { ServerOptions } from "http-proxy"
import * as url from "url"
import logger from "./logger"
import { KubeAuthProxy } from "./kube-auth-proxy"
import { Cluster, ClusterPreferences } from "./cluster"
import { prometheusProviders } from "../common/prometheus-providers"
import { PrometheusService, PrometheusProvider } from "./prometheus/provider-registry"

export class ContextHandler {
  public contextName: string
  public id: string
  public url: string
  public kc: KubeConfig
  public certData: string
  public authCertData: string
  public cluster: Cluster

  protected apiTarget: ServerOptions
  protected proxyTarget: ServerOptions
  protected clusterUrl: url.UrlWithStringQuery
  protected proxyServer: KubeAuthProxy

  protected clientCert: string
  protected clientKey: string
  protected secureApiConnection = true
  protected defaultNamespace: string
  protected proxyPort: number
  protected kubernetesApi: string
  protected prometheusProvider: string
  protected prometheusPath: string
  protected clusterName: string

  constructor(kc: KubeConfig, cluster: Cluster) {
    this.id = cluster.id
    this.kc = new KubeConfig()
    this.kc.users = [
      {
        name: kc.getCurrentUser().name,
        token: this.id
      }
    ]
    this.kc.contexts = [
      {
        name: kc.currentContext,
        cluster: kc.getCurrentCluster().name,
        user: kc.getCurrentUser().name,
        namespace: kc.getContextObject(kc.currentContext).namespace
      }
    ]
    this.kc.setCurrentContext(kc.currentContext)

    this.cluster = cluster
    this.clusterUrl = url.parse(kc.getCurrentCluster().server)
    this.contextName = kc.currentContext;
    this.defaultNamespace = kc.getContextObject(kc.currentContext).namespace
    this.url = `http://${this.id}.localhost:${cluster.port}/`
    this.kubernetesApi = `http://127.0.0.1:${cluster.port}/${this.id}`
    this.kc.clusters = [
      {
        name: kc.getCurrentCluster().name,
        server: this.kubernetesApi,
        skipTLSVerify: true
      }
    ]
    this.setClusterPreferences(cluster.preferences)
  }

  public setClusterPreferences(clusterPreferences?: ClusterPreferences) {
    this.prometheusProvider = clusterPreferences.prometheusProvider?.type

    if (clusterPreferences && clusterPreferences.prometheus) {
      const prom = clusterPreferences.prometheus
      this.prometheusPath = `${prom.namespace}/services/${prom.service}:${prom.port}`
    } else {
      this.prometheusPath = null
    }
    if(clusterPreferences && clusterPreferences.clusterName) {
      this.clusterName = clusterPreferences.clusterName;
    } else {
      this.clusterName = this.contextName;
    }
  }

  protected async resolvePrometheusPath(): Promise<string> {
    const service = await this.getPrometheusService()
    return `${service.namespace}/services/${service.service}:${service.port}`
  }

  public async getPrometheusProvider() {
    if (!this.prometheusProvider) {
      const service = await this.getPrometheusService()
      logger.info(`using ${service.id} as prometheus provider`)
      this.prometheusProvider = service.id
    }
    return prometheusProviders.find(p => p.id === this.prometheusProvider)
  }

  public async getPrometheusService(): Promise<PrometheusService> {
    const providers = this.prometheusProvider ? prometheusProviders.filter((p, _) => p.id == this.prometheusProvider) : prometheusProviders
    const prometheusPromises: Promise<PrometheusService>[] = providers.map(async (provider: PrometheusProvider): Promise<PrometheusService> => {
      const apiClient = this.kc.makeApiClient(CoreV1Api)
      return await provider.getPrometheusService(apiClient)
    })
    const resolvedPrometheusServices = await Promise.all(prometheusPromises)
    const service = resolvedPrometheusServices.filter(n => n)[0]
    if (service) {
      return service
    } else {
      return {
        id: "lens",
        namespace: "lens-metrics",
        service: "prometheus",
        port: 80
      }
    }
  }

  public async getPrometheusPath(): Promise<string> {
    if (this.prometheusPath) return this.prometheusPath

    this.prometheusPath = await this.resolvePrometheusPath()

    return this.prometheusPath
  }

  public async getApiTarget(isWatchRequest = false) {
    if (this.apiTarget && !isWatchRequest) {
      return this.apiTarget
    }
    const timeout = isWatchRequest ? 4 * 60 * 60 * 1000 : 30000 // 4 hours for watch request, 30 seconds for the rest
    const apiTarget = await this.newApiTarget(timeout)
    if (!isWatchRequest) {
      this.apiTarget = apiTarget
    }
    return apiTarget
  }

  protected async newApiTarget(timeout: number) {
    return {
      changeOrigin: true,
      timeout: timeout,
      headers: {
        "Host": this.clusterUrl.hostname
      },
      target: {
        socketPath: this.cluster.proxySocketPath(),
        protocol: "http://",
        host: "localhost",
        path: this.clusterUrl.path
      },
    }
  }

  public applyHeaders(req: http.IncomingMessage) {
    req.headers["authorization"] = `Bearer ${this.id}`
  }

  public async withTemporaryKubeconfig(callback: (kubeconfig: string) => Promise<any>) {
    try {
      await callback(this.cluster.kubeconfigPath())
    } catch(error) {
      throw(error)
    }
  }

  public async ensureServer() {
    if (!this.proxyServer) {
      const proxyEnv = Object.assign({}, process.env)
      if (this.cluster.preferences && this.cluster.preferences.httpsProxy) {
        proxyEnv.HTTPS_PROXY = this.cluster.preferences.httpsProxy
      }
      this.proxyServer = new KubeAuthProxy(this.cluster, proxyEnv)
      await this.proxyServer.run()
    }
  }

  public stopServer() {
    if (this.proxyServer) {
      this.proxyServer.exit()
      this.proxyServer = null
    }
  }

  public proxyServerError() {
    if (!this.proxyServer) { return null }

    return this.proxyServer.lastError
  }
}
