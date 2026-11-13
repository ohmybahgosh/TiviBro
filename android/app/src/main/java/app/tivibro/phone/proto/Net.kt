/* Network: HTTP calls to a TV's phone app API (port 47810), UDP discovery of TVs on the network, and
   Wake-on-LAN. */
package app.tivibro.phone.proto

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/** A TV that answered discovery. */
data class Found(val id: String, val name: String, val host: String, val port: Int, val version: String)

/** The broadcast addresses of this phone's networks (Wi-Fi, Ethernet), plus the general one. */
fun broadcasts(): List<InetAddress> {
    val out = mutableListOf<InetAddress>()
    runCatching {
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().filter { it.isUp && !it.isLoopback }.forEach { nif ->
            nif.interfaceAddresses.forEach { a -> if (a.address is Inet4Address && a.broadcast != null) out += a.broadcast }
        }
    }
    out += InetAddress.getByName("255.255.255.255")
    return out.distinct()
}

object Discovery {
    /** Asks every TiviBro on the network, and collects answers for [ms]. */
    fun find(ms: Long = 1800, targets: List<InetAddress> = broadcasts(), port: Int = DEFAULT_PORT): List<Found> {
        val found = LinkedHashMap<String, Found>()
        DatagramSocket().use { s ->
            s.broadcast = true
            s.soTimeout = 250
            val msg = DISCOVER.toByteArray(Charsets.UTF_8)
            val end = System.currentTimeMillis() + ms
            var sends = 0
            var nextSend = 0L
            val buf = ByteArray(2048)
            while (System.currentTimeMillis() < end) {
                if (sends < 3 && System.currentTimeMillis() >= nextSend) {
                    targets.forEach { t -> runCatching { s.send(DatagramPacket(msg, msg.size, t, port)) } }
                    sends++
                    nextSend = System.currentTimeMillis() + 500
                }
                try {
                    val p = DatagramPacket(buf, buf.size)
                    s.receive(p)
                    val j = JSONObject(String(p.data, 0, p.length, Charsets.UTF_8))
                    if (j.optString("app") == "TiviBro") {
                        val id = j.getString("id")
                        found[id] = Found(id, j.optString("name", "TV"), p.address.hostAddress ?: continue, j.optInt("port", DEFAULT_PORT), j.optString("version", ""))
                    }
                } catch (e: SocketTimeoutException) {
                    // nothing yet: ask again or keep listening
                } catch (e: Exception) {
                    // not a TiviBro answer
                }
            }
        }
        return found.values.toList()
    }
}

/**
 * Every address of this phone's own networks (a /24 at most), asked for TiviBro directly: for a router that
 * moved the TV to another address overnight while broadcasts don't get through (Wi-Fi client isolation, some
 * mesh systems), so discovery found nothing.  Up to 254 quick asks, 32 at a time.
 */
object Sweep {
    fun lanHosts(): List<String> {
        val out = LinkedHashSet<String>()
        runCatching {
            NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().filter { it.isUp && !it.isLoopback }.forEach { nif ->
                nif.interfaceAddresses.forEach { a ->
                    val ip = a.address as? Inet4Address ?: return@forEach
                    if (!ip.isSiteLocalAddress) return@forEach
                    val b = ip.address
                    for (i in 1..254) if (i != (b[3].toInt() and 0xff)) out += "${b[0].toInt() and 0xff}.${b[1].toInt() and 0xff}.${b[2].toInt() and 0xff}.$i"
                }
            }
        }
        return out.toList()
    }
    /** The TiviBros that answer, by id. */
    fun find(port: Int = DEFAULT_PORT, hosts: List<String> = lanHosts(), timeoutMs: Int = 600): List<Found> {
        val pool = java.util.concurrent.Executors.newFixedThreadPool(32)
        try {
            val jobs = hosts.map { h -> pool.submit<Found?> {
                // A quick connect first: most addresses have nothing there, and this spares a full request.
                val open = runCatching { java.net.Socket().use { it.connect(java.net.InetSocketAddress(h, port), timeoutMs) }; true }.getOrDefault(false)
                if (!open) null else runCatching { val hi = Pairing.hello(h, port, 1500); Found(hi.id, hi.name, h, port, hi.version) }.getOrNull()
            } }
            return jobs.mapNotNull { runCatching { it.get(5, java.util.concurrent.TimeUnit.SECONDS) }.getOrNull() }
        } finally { pool.shutdownNow() }
    }
}

object Wol {
    /** "aa:bb:cc:dd:ee:ff" to 6 bytes, or null. */
    fun macBytes(mac: String): ByteArray? {
        val parts = mac.split(':', '-')
        if (parts.size != 6) return null
        return runCatching { ByteArray(6) { parts[it].toInt(16).toByte() } }.getOrNull()
    }

    fun packet(mac: ByteArray): ByteArray = ByteArray(6) { 0xFF.toByte() } + (1..16).flatMap { mac.toList() }.toByteArray()

    /** Every card in [macs] (a TV's built-in Wi-Fi and Ethernet both, as LG's ThinQ app does). */
    fun wakeAll(macs: List<String>, lastHost: String? = null): Boolean = macs.map { wake(it, lastHost) }.any { it }

    /** Magic packets to every broadcast address, on ports 9 and 7, and straight to the TV's last address. */
    fun wake(mac: String, lastHost: String? = null): Boolean {
        val m = macBytes(mac) ?: return false
        val p = packet(m)
        DatagramSocket().use { s ->
            s.broadcast = true
            val to = broadcasts().toMutableList()
            lastHost?.let { h -> runCatching { to += InetAddress.getByName(h) } }
            to.forEach { a -> for (port in intArrayOf(9, 7)) runCatching { s.send(DatagramPacket(p, p.size, a, port)) } }
        }
        return true
    }
}
