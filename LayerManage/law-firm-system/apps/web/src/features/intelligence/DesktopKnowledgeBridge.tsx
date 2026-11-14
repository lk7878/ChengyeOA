import { useEffect } from 'react';
import { mountDesktopKnowledgeBridge } from './desktop-knowledge-bridge';
export default function DesktopKnowledgeBridge() {
  useEffect(mountDesktopKnowledgeBridge, []);
  return null;
}
