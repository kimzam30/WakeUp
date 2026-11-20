package expo.modules.wakeupdnd

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

// Turns Do Not Disturb on for a focus session and back off when it ends. The end is an alarm in Android itself, so it
// happens even when WakeUp is closed, and it is set again after a restart. WakeUp only undoes what it did: if the
// user changed Do Not Disturb meanwhile, their choice stays.
object Dnd {
  private const val PREFS = "wakeup.dnd"
  const val RESTORE = "expo.modules.wakeupdnd.RESTORE"

  private fun nm(c: Context) = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun hasAccess(c: Context) = nm(c).isNotificationPolicyAccessGranted

  private fun alarm(c: Context) = PendingIntent.getBroadcast(
    c, 0, Intent(c, DndRestoreReceiver::class.java).setAction(RESTORE),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
  )

  fun quietUntil(c: Context, until: Long): Boolean {
    if (!hasAccess(c) || until <= System.currentTimeMillis()) return false
    val p = prefs(c)
    if (!p.getBoolean("on", false)) {
      p.edit().putInt("prev", nm(c).currentInterruptionFilter).apply()
      nm(c).setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
    }
    p.edit().putBoolean("on", true).putLong("until", until).apply()
    schedule(c, until)
    return true
  }

  fun schedule(c: Context, at: Long) {
    val am = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    try { am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm(c)) }
    catch (e: SecurityException) { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm(c)) }
  }

  fun restore(c: Context) {
    val p = prefs(c)
    (c.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(alarm(c))
    if (!p.getBoolean("on", false)) return
    val prev = p.getInt("prev", NotificationManager.INTERRUPTION_FILTER_ALL)
    if (hasAccess(c) && nm(c).currentInterruptionFilter == NotificationManager.INTERRUPTION_FILTER_PRIORITY) {
      nm(c).setInterruptionFilter(if (prev == NotificationManager.INTERRUPTION_FILTER_UNKNOWN) NotificationManager.INTERRUPTION_FILTER_ALL else prev)
    }
    p.edit().putBoolean("on", false).remove("until").apply()
  }

  // after a restart: the alarm is gone, so set it again (or restore now if the session already ended)
  fun afterBoot(c: Context) {
    val p = prefs(c)
    if (!p.getBoolean("on", false)) return
    val until = p.getLong("until", 0)
    if (until <= System.currentTimeMillis()) restore(c) else schedule(c, until)
  }
}
