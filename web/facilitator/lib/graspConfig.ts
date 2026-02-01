/**
 * Shared types and utilities for Grasp configuration management
 */

export interface GraspConfig {
  configId: string;
  name: string;
  yaml: string;
  createdAt: number;
  updatedAt?: number;
}

export interface GroupedConfig {
  name: string;
  latestVersion: GraspConfig;
  versions: GraspConfig[];
  expanded: boolean;
}

/**
 * Groups Grasp configurations by name and sorts them by creation date
 * @param configs - Array of Grasp configurations to group
 * @returns Array of grouped configurations, sorted by latest version's creation date
 */
export function groupConfigsByName(configs: GraspConfig[]): GroupedConfig[] {
  const groups: { [name: string]: GraspConfig[] } = {};

  // Group by name
  configs.forEach((config) => {
    if (!groups[config.name]) {
      groups[config.name] = [];
    }
    groups[config.name].push(config);
  });

  // Convert to array and sort versions by createdAt (newest first)
  return Object.entries(groups).map(([name, versions]) => {
    const sortedVersions = versions.sort((a, b) => b.createdAt - a.createdAt);
    return {
      name,
      latestVersion: sortedVersions[0],
      versions: sortedVersions,
      expanded: false,
    };
  }).sort((a, b) => b.latestVersion.createdAt - a.latestVersion.createdAt); // Sort groups by latest version
}
