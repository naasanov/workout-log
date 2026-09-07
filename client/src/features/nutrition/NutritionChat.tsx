/**
 * NutritionChat — the AI chat bottom sheet on the nutrition tab.
 *
 * Thin wrapper around the generic features/agent/AgentChat: registers
 * nutrition's tool renderers (propose_entry, propose_custom_food, and the
 * barcode-attachment part) and supplies the photo/barcode composer plugin.
 * Everything else (the sheet, drag/snap, transport, transcript persistence,
 * process timeline) lives in features/agent.
 */
import AgentChat from '../agent/AgentChat';
import { useNutritionComposerExtras } from './NutritionComposerExtras';
// Registers nutrition's tool/part renderers for their side effect.
import './NutritionToolRenderers';
import './NutritionBarcodeChip';

interface NutritionChatProps {
  open: boolean;
  onClose: () => void;
  selectedDate: string;
}

export default function NutritionChat({ open, onClose, selectedDate }: NutritionChatProps) {
  const { plugin, modals } = useNutritionComposerExtras();

  return (
    <>
      <AgentChat
        open={open}
        onClose={onClose}
        context={{ tab: 'nutrition', selectedDate }}
        composerPlugin={plugin}
        emptyHint="Describe what you ate, scan a barcode, or attach a photo of your food."
        srLabel="Nutrition AI"
        composerPlaceholder="Describe what you ate…"
      />
      {modals}
    </>
  );
}
