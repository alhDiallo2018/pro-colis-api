import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/parcel.dart';
import '../../models/user.dart';
import '../../services/api_service.dart';

class AdminStatsScreen extends ConsumerStatefulWidget {
  const AdminStatsScreen({super.key});

  @override
  ConsumerState<AdminStatsScreen> createState() => _AdminStatsScreenState();
}

class _AdminStatsScreenState extends ConsumerState<AdminStatsScreen> {
  final ApiService _apiService = ApiService();
  List<User> _users = [];
  List<Parcel> _parcels = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final users = await _apiService.getAllUsersSuperAdmin();
      final parcels = await _apiService.getAllParcelsSuperAdmin();

      setState(() {
        _users = users;
        _parcels = parcels;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _refreshData() async {
    await _loadData();
  }

  int get _totalUsers => _users.length;
  int get _totalDrivers => _users.where((u) => u.role == UserRole.driver).length;
  int get _totalParcels => _parcels.length;
  int get _parcelsInTransit => _parcels.where((p) => 
    p.status == ParcelStatus.inTransit || 
    p.status == ParcelStatus.outForDelivery ||
    p.status == ParcelStatus.pickedUp
  ).length;
  int get _parcelsDelivered => _parcels.where((p) => p.status == ParcelStatus.delivered).length;
  double get _totalRevenue => _parcels.where((p) => p.status == ParcelStatus.delivered).fold(0.0, (sum, p) => sum + (p.price ?? 0));

  List<Map<String, dynamic>> get _recentActivities {
    final activities = <Map<String, dynamic>>[];
    
    // Ajouter les 5 derniers utilisateurs
    for (var user in _users.reversed.take(5)) {
      activities.add({
        'type': 'user',
        'title': 'Nouvel utilisateur',
        'description': 'Inscription de ${user.fullName}',
        'time': user.createdAt,
        'icon': Icons.person_add,
        'color': Colors.green,
      });
    }
    
    // Ajouter les 5 derniers colis
    for (var parcel in _parcels.reversed.take(5)) {
      final statusText = parcel.status.label;
      activities.add({
        'type': 'parcel',
        'title': 'Colis $statusText',
        'description': '${parcel.trackingNumber} - ${parcel.receiverName}',
        'time': parcel.createdAt,
        'icon': parcel.status == ParcelStatus.delivered ? Icons.check_circle : Icons.local_shipping,
        'color': parcel.status == ParcelStatus.delivered ? Colors.green : Colors.orange,
      });
    }
    
    // Trier par date décroissante
    activities.sort((a, b) => (b['time'] as DateTime).compareTo(a['time'] as DateTime));
    
    // Retourner les 10 plus récentes (sans toList() inutile)
    return activities.take(10).toList();
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);
    
    if (difference.inDays > 7) {
      return '${date.day}/${date.month}/${date.year}';
    } else if (difference.inDays > 0) {
      return 'Il y a ${difference.inDays} jour${difference.inDays > 1 ? 's' : ''}';
    } else if (difference.inHours > 0) {
      return 'Il y a ${difference.inHours} heure${difference.inHours > 1 ? 's' : ''}';
    } else if (difference.inMinutes > 0) {
      return 'Il y a ${difference.inMinutes} minute${difference.inMinutes > 1 ? 's' : ''}';
    } else {
      return 'À l\'instant';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tableau de bord'),
        backgroundColor: const Color(0xFF0B6E3A),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _refreshData,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshData,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.error_outline, size: 64, color: Colors.red),
                        const SizedBox(height: 16),
                        Text('Erreur: $_error'),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _loadData,
                          child: const Text('Réessayer'),
                        ),
                      ],
                    ),
                  )
                : SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        // Cartes de statistiques - Première ligne
                        Row(
                          children: [
                            _StatsCard(
                              title: 'Utilisateurs',
                              value: _totalUsers.toString(),
                              icon: Icons.people,
                              color: Colors.blue,
                            ),
                            const SizedBox(width: 12),
                            _StatsCard(
                              title: 'Chauffeurs',
                              value: _totalDrivers.toString(),
                              icon: Icons.delivery_dining,
                              color: Colors.green,
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        
                        // Cartes de statistiques - Deuxième ligne
                        Row(
                          children: [
                            _StatsCard(
                              title: 'Colis',
                              value: _totalParcels.toString(),
                              icon: Icons.inventory,
                              color: Colors.orange,
                            ),
                            const SizedBox(width: 12),
                            _StatsCard(
                              title: 'Colis livrés',
                              value: _parcelsDelivered.toString(),
                              icon: Icons.check_circle,
                              color: Colors.teal,
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        
                        // Cartes de statistiques - Troisième ligne
                        Row(
                          children: [
                            _StatsCard(
                              title: 'En transit',
                              value: _parcelsInTransit.toString(),
                              icon: Icons.local_shipping,
                              color: Colors.purple,
                            ),
                            const SizedBox(width: 12),
                            _StatsCard(
                              title: 'Revenus',
                              value: '${_totalRevenue.toInt()} FCFA',
                              icon: Icons.attach_money,
                              color: Colors.green,
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        
                        // Graphique des revenus (version simplifiée)
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Aperçu des colis',
                                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                                ),
                                const SizedBox(height: 16),
                                _buildParcelStatusChart(),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        
                        // Dernières activités
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Dernières activités',
                                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                                ),
                                const SizedBox(height: 12),
                                if (_recentActivities.isEmpty)
                                  const Padding(
                                    padding: EdgeInsets.all(32),
                                    child: Center(
                                      child: Text('Aucune activité récente'),
                                    ),
                                  )
                                else
                                  ..._recentActivities.map((activity) => Column(
                                    children: [
                                      ListTile(
                                        leading: Container(
                                          padding: const EdgeInsets.all(8),
                                          decoration: BoxDecoration(
                                            color: (activity['color'] as Color).withAlpha(25),
                                            borderRadius: BorderRadius.circular(10),
                                          ),
                                          child: Icon(activity['icon'] as IconData, color: activity['color'] as Color),
                                        ),
                                        title: Text(activity['title'] as String),
                                        subtitle: Text(
                                          activity['description'] as String,
                                          style: const TextStyle(fontSize: 12, color: Colors.grey),
                                        ),
                                        trailing: Text(
                                          _formatDate(activity['time'] as DateTime),
                                          style: const TextStyle(fontSize: 12),
                                        ),
                                      ),
                                      const Divider(),
                                    ],
                                  )),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
      ),
    );
  }

  Widget _buildParcelStatusChart() {
    final Map<String, int> statusCount = {
      'En attente': _parcels.where((p) => p.status == ParcelStatus.pending).length,
      'Confirmés': _parcels.where((p) => p.status == ParcelStatus.confirmed).length,
      'Ramassés': _parcels.where((p) => p.status == ParcelStatus.pickedUp).length,
      'En transit': _parcels.where((p) => p.status == ParcelStatus.inTransit).length,
      'Arrivés': _parcels.where((p) => p.status == ParcelStatus.arrived).length,
      'En livraison': _parcels.where((p) => p.status == ParcelStatus.outForDelivery).length,
      'Livrés': _parcels.where((p) => p.status == ParcelStatus.delivered).length,
      'Annulés': _parcels.where((p) => p.status == ParcelStatus.cancelled).length,
    };

    final colors = {
      'En attente': Colors.grey,
      'Confirmés': Colors.blue,
      'Ramassés': Colors.teal,
      'En transit': Colors.orange,
      'Arrivés': Colors.purple,
      'En livraison': Colors.deepOrange,
      'Livrés': Colors.green,
      'Annulés': Colors.red,
    };

    return Column(
      children: statusCount.entries.where((e) => e.value > 0).map((entry) {
        final percentage = _totalParcels > 0 ? entry.value / _totalParcels : 0.0;
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(entry.key, style: const TextStyle(fontSize: 14)),
                  Text(
                    '${entry.value} colis (${(percentage * 100).toStringAsFixed(1)}%)',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              LinearProgressIndicator(
                value: percentage,
                backgroundColor: Colors.grey.shade200,
                color: colors[entry.key],
                minHeight: 8,
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

class _StatsCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _StatsCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: color.withAlpha(25),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withAlpha(50)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withAlpha(50),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 24),
            ),
            const SizedBox(height: 12),
            Text(
              value,
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: color),
            ),
            const SizedBox(height: 4),
            Text(title, style: TextStyle(fontSize: 12, color: Colors.grey[600])),
          ],
        ),
      ),
    );
  }
}