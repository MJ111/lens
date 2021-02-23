import React from "react";
import { ipcRenderer, IpcRendererEvent } from "electron";
import { UpdateAvailableArgs, BackchannelArg, ClusterIdArgList, updateAvailale, clusterListNamespacesForbidden } from "../../common/ipc";
import { Notifications, notificationsStore } from "../components/notifications";
import { Button } from "../components/button";
import { isMac } from "../../common/vars";
import * as uuid from "uuid";
import { clusterStore } from "../../common/cluster-store";
import { navigate } from "../navigation";
import { clusterSettingsURL } from "../components/+cluster-settings";

function sendToBackchannel(backchannel: string, notificationId: string, data: BackchannelArg): void {
  notificationsStore.remove(notificationId);
  ipcRenderer.send(backchannel, data);
}

function RenderYesButtons(props: { backchannel: string, notificationId: string }) {
  if (isMac) {
    /**
     * auto-updater's "installOnQuit" is not applicable for macOS as per their docs.
     *
     * See: https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/AppUpdater.ts#L27-L32
     */
    return <Button light label="Yes" onClick={() => sendToBackchannel(props.backchannel, props.notificationId, { doUpdate: true, now: true })} />;
  }

  return (
    <>
      <Button light label="Yes, now" onClick={() => sendToBackchannel(props.backchannel, props.notificationId, { doUpdate: true, now: true })} />
      <Button active outlined label="Yes, later" onClick={() => sendToBackchannel(props.backchannel, props.notificationId, { doUpdate: true, now: false })} />
    </>
  );
}

function UpdateAvailableHandler(event: IpcRendererEvent, ...[backchannel, updateInfo]: UpdateAvailableArgs): void {
  const notificationId = uuid.v4();

  Notifications.info(
    (
      <div className="flex column gaps">
        <b>Update Available</b>
        <p>Version {updateInfo.version} of Lens IDE is now available. Would you like to update?</p>
        <div className="flex gaps row align-left box grow">
          <RenderYesButtons backchannel={backchannel} notificationId={notificationId} />
          <Button active outlined label="No" onClick={() => sendToBackchannel(backchannel, notificationId, { doUpdate: false })} />
        </div>
      </div>
    ),
    {
      id: notificationId,
      onClose() {
        sendToBackchannel(backchannel, notificationId, { doUpdate: false });
      }
    }
  );
}

const listNamespacesForbiddenHandlerDisplayedAt = new Map<string, number>();
const intervalBetweenNotifications = 1000 * 60; // 60s

function ListNamespacesForbiddenHandler(event: IpcRendererEvent, ...[clusterId]: ClusterIdArgList): void {
  const lastDisplayedAt = listNamespacesForbiddenHandlerDisplayedAt.get(clusterId);
  const wasDisplayed = Boolean(lastDisplayedAt);
  const now = Date.now();

  if (!wasDisplayed || (now - lastDisplayedAt) > intervalBetweenNotifications) {
    listNamespacesForbiddenHandlerDisplayedAt.set(clusterId, now);
  } else  {
    // don't bother the user too often
    return;
  }

  const notificationId = `list-namespaces-forbidden:${clusterId}`;

  Notifications.info(
    (
      <div className="flex column gaps">
        <b>Add Accessible Namespaces</b>
        <p>Cluster <b>{clusterStore.active.name}</b> does not have permissions to list namespaces. Please add the namespaces you have access to.</p>
        <div className="flex gaps row align-left box grow">
          <Button active outlined label="Cluster Settings" onClick={()=> {
            navigate(clusterSettingsURL({ params: { clusterId }, fragment: "accessible-namespaces" }));
            notificationsStore.remove(notificationId);
          }} />
        </div>
      </div>
    ),
    {
      id: notificationId,
    }
  );
}

export function registerIpcHandlers() {
  updateAvailale.on(UpdateAvailableHandler);
  clusterListNamespacesForbidden.on(ListNamespacesForbiddenHandler);
}