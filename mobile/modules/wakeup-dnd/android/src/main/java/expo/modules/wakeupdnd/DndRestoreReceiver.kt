package expo.modules.wakeupdnd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DndRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) {
    if (i.action == Intent.ACTION_BOOT_COMPLETED) Dnd.afterBoot(c) else Dnd.restore(c)
  }
}
