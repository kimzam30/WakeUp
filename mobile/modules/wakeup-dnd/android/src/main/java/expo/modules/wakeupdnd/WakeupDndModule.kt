package expo.modules.wakeupdnd

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WakeupDndModule : Module() {
  private val ctx get() = requireNotNull(appContext.reactContext) { "no context" }

  override fun definition() = ModuleDefinition {
    Name("WakeupDnd")
    Function("hasAccess") { Dnd.hasAccess(ctx) }
    Function("openAccessSettings") {
      ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    Function("quietUntil") { untilMs: Double -> Dnd.quietUntil(ctx, untilMs.toLong()) }
    Function("restore") { Dnd.restore(ctx) }
  }
}
