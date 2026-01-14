/**
 * MessageNotifier
 *
 * Re-exports the Notifier interface from grasp.ts for adapter implementations.
 * This provides a clean separation between the grasp framework and platform adapters.
 */

export { Notifier as MessageNotifier } from '../../grasp';
