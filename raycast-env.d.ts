/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** SSH User - User account on the SSH gateway */
  "sshUser": string,
  /** SSH Gateway - SSH gateway used to reach the routed websites */
  "sshHost": string,
  /** SSH Port - Port used to connect to the SSH gateway */
  "sshPort": string,
  /** SSH Identity File - Optional private-key path; leave empty to use your SSH agent/config */
  "identityFile"?: string,
  /** Routed Websites - Comma-separated exact hosts or wildcards; URLs are also accepted */
  "routedHosts": string,
  /** Primary Website URL - Optional website opened by the main menu action; defaults to the first routed host */
  "primaryURL"?: string,
  /** Local SOCKS Port - Local port for the SSH dynamic forward */
  "socksPort": string,
  /** Local PAC Port - Local port serving Safari's host-specific proxy configuration */
  "pacPort": string,
  /** Start Timeout - Seconds to wait for the SSH tunnel */
  "startTimeout": string,
  /** Network Services - Optional comma-separated macOS network services; empty means every enabled service */
  "networkServices"?: string,
  /** Open in Safari - Use Safari for the Open Website menu actions */
  "openInSafari": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `menu-bar` command */
  export type MenuBar = ExtensionPreferences & {}
  /** Preferences accessible in the `toggle` command */
  export type Toggle = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `menu-bar` command */
  export type MenuBar = {}
  /** Arguments passed to the `toggle` command */
  export type Toggle = {}
}

