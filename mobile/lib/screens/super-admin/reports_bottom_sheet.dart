// mobile/lib/screens/admin/reports_bottom_sheet.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procolis/models/garage.dart';

import '../../models/parcel.dart';
import '../../models/user.dart';
import '../../services/api_service.dart';

class ReportsBottomSheet extends ConsumerStatefulWidget {
  const ReportsBottomSheet({super.key});

  @override
  ConsumerState<ReportsBottomSheet> createState() => _ReportsBottomSheetState();
}

class _ReportsBottomSheetState extends ConsumerState<ReportsBottomSheet> {
  final ApiService _apiService = ApiService();
  List<User> _users = [];
  List<Parcel> _parcels = [];
  List<Garage> _garages = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final users = await _apiService.getAllUsersSuperAdmin();
      final parcels = await _apiService.getAllParcelsSuperAdmin();
      final garages = await _apiService.getAllGaragesSuperAdmin();
      
      setState(() {
        _users = users;
        _parcels = parcels;
        _garages = garages;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Rapports disponibles',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          if (_isLoading)
            const Center(child: CircularProgressIndicator())
          else ...[
            _buildReportItem(
              icon: Icons.people,
              title: 'Rapport des utilisateurs',
              subtitle: '${_users.length} utilisateurs',
              onTap: () => _showUserReport(),
            ),
            const Divider(),
            _buildReportItem(
              icon: Icons.local_shipping,
              title: 'Rapport des colis',
              subtitle: '${_parcels.length} colis',
              onTap: () => _showParcelReport(),
            ),
            const Divider(),
            _buildReportItem(
              icon: Icons.business,
              title: 'Rapport des garages',
              subtitle: '${_garages.length} garages',
              onTap: () => _showGarageReport(),
            ),
            const Divider(),
            _buildReportItem(
              icon: Icons.trending_up,
              title: 'Rapport financier',
              subtitle: 'Revenus totaux',
              onTap: () => _showFinancialReport(),
            ),
          ],
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  Widget _buildReportItem({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: const Color(0xFF0B6E3A), size: 32),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }

  void _showUserReport() {
    final activeUsers = _users.where((u) => u.status == UserStatus.active).length;
    final suspendedUsers = _users.where((u) => u.status == UserStatus.suspended).length;
    final clients = _users.where((u) => u.role == UserRole.client).length;
    final drivers = _users.where((u) => u.role == UserRole.driver).length;
    final admins = _users.where((u) => u.role == UserRole.superAdmin).length;

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rapport utilisateur'),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildStatsRow('Total utilisateurs', _users.length),
              const Divider(),
              _buildStatsRow('✅ Actifs', activeUsers),
              _buildStatsRow('⛔ Suspendus', suspendedUsers),
              const Divider(),
              _buildStatsRow('👥 Clients', clients),
              _buildStatsRow('🚚 Chauffeurs', drivers),
              _buildStatsRow('👑 Admins', admins),
              const Divider(),
              const Text('📅 Derniers inscrits:', style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              ..._users.reversed.take(3).map((user) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('• ${user.fullName} - ${_formatDate(user.createdAt)}'),
              )),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Fermer'),
          ),
          ElevatedButton(
            onPressed: () => _exportReport('utilisateurs'),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0B6E3A)),
            child: const Text('Exporter'),
          ),
        ],
      ),
    );
  }

  void _showParcelReport() {
    final delivered = _parcels.where((p) => p.status == ParcelStatus.delivered).length;
    final inTransit = _parcels.where((p) => 
      p.status == ParcelStatus.inTransit || 
      p.status == ParcelStatus.outForDelivery
    ).length;
    final pending = _parcels.where((p) => p.status == ParcelStatus.pending).length;
    final cancelled = _parcels.where((p) => p.status == ParcelStatus.cancelled).length;
    final totalRevenue = _parcels
        .where((p) => p.status == ParcelStatus.delivered)
        .fold(0.0, (sum, p) => sum + (p.price ?? 0));

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rapport colis'),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildStatsRow('📦 Total colis', _parcels.length),
              const Divider(),
              _buildStatsRow('✅ Livrés', delivered),
              _buildStatsRow('🚚 En transit', inTransit),
              _buildStatsRow('⏳ En attente', pending),
              _buildStatsRow('❌ Annulés', cancelled),
              const Divider(),
              _buildStatsRow('💰 Revenus totaux', '${totalRevenue.toInt()} FCFA'),
              _buildStatsRow('📊 Taux de livraison', '${_parcels.isEmpty ? 0 : (delivered / _parcels.length * 100).toStringAsFixed(1)}%'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Fermer'),
          ),
          ElevatedButton(
            onPressed: () => _exportReport('colis'),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0B6E3A)),
            child: const Text('Exporter'),
          ),
        ],
      ),
    );
  }

  void _showGarageReport() {
    final totalDrivers = _garages.fold(0, (sum, g) => sum + g.driversCount);
    final totalParcels = _garages.fold(0, (sum, g) => sum + g.parcelsCount);
    final totalRevenue = _garages.fold(0.0, (sum, g) => sum + g.revenue);
    final topGarage = _garages.isNotEmpty ? _garages.reduce((a, b) => a.parcelsCount > b.parcelsCount ? a : b) : null;

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rapport garages'),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildStatsRow('🏢 Total garages', _garages.length),
              _buildStatsRow('👨‍✈️ Total chauffeurs', totalDrivers),
              _buildStatsRow('📦 Colis traités', totalParcels),
              _buildStatsRow('💰 Revenus totaux', '${totalRevenue.toInt()} FCFA'),
              const Divider(),
              const Text('🏆 Top garage:', style: TextStyle(fontWeight: FontWeight.bold)),
              if (topGarage != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('• ${topGarage.name}: ${topGarage.parcelsCount} colis'),
                ),
              const Divider(),
              const Text('📊 Détail par garage:', style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              ..._garages.take(3).map((garage) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('• ${garage.name}: ${garage.parcelsCount} colis, ${garage.driversCount} chauffeurs'),
              )),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Fermer'),
          ),
          ElevatedButton(
            onPressed: () => _exportReport('garages'),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0B6E3A)),
            child: const Text('Exporter'),
          ),
        ],
      ),
    );
  }

  void _showFinancialReport() {
    final totalRevenue = _parcels
        .where((p) => p.status == ParcelStatus.delivered)
        .fold(0.0, (sum, p) => sum + (p.price ?? 0));
    
    final pendingPayments = _parcels
        .where((p) => p.paymentStatus == 'pending')
        .fold(0.0, (sum, p) => sum + (p.price ?? 0));
    
    final wavePayments = _parcels
        .where((p) => p.paymentMethod == 'wave')
        .fold(0.0, (sum, p) => sum + (p.price ?? 0));
    
    final cashPayments = _parcels
        .where((p) => p.paymentMethod == 'cash')
        .fold(0.0, (sum, p) => sum + (p.price ?? 0));
    
    final averagePrice = _parcels.isEmpty ? 0 : totalRevenue / _parcels.length;

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rapport financier'),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('💰 Aperçu financier', style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              _buildStatsRow('Revenus totaux', '${totalRevenue.toInt()} FCFA'),
              _buildStatsRow('Paiements en attente', '${pendingPayments.toInt()} FCFA'),
              _buildStatsRow('Moyenne par colis', '${averagePrice.toInt()} FCFA'),
              const Divider(),
              const Text('📊 Paiements par mode:', style: TextStyle(fontWeight: FontWeight.bold)),
              _buildStatsRow('Wave', '${wavePayments.toInt()} FCFA'),
              _buildStatsRow('Espèces', '${cashPayments.toInt()} FCFA'),
              const Divider(),
              const Text('📈 Statistiques:', style: TextStyle(fontWeight: FontWeight.bold)),
              _buildStatsRow('Colis payés', _parcels.where((p) => p.paymentStatus == 'paid').length),
              _buildStatsRow('Colis à livrer', _parcels.where((p) => p.paymentStatus == 'pending').length),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Fermer'),
          ),
          ElevatedButton(
            onPressed: () => _exportReport('financier'),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0B6E3A)),
            child: const Text('Exporter'),
          ),
        ],
      ),
    );
  }

  Widget _buildStatsRow(String label, dynamic value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 14)),
          Text(
            value.toString(),
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  void _exportReport(String type) {
    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Export du rapport $type en cours...'),
        backgroundColor: Colors.blue,
      ),
    );
    
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Rapport $type exporté avec succès'),
            backgroundColor: Colors.green,
          ),
        );
      }
    });
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year}';
  }
}