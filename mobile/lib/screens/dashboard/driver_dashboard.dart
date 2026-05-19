// mobile/lib/screens/dashboard/driver_dashboard.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procolis/models/parcel.dart';
import 'package:procolis/models/user.dart';
import 'package:procolis/services/api_service.dart';

import '../../providers/auth_provider.dart';
import '../../providers/parcel_provider.dart';
import '../profile/profile_screen.dart';

class DriverDashboard extends ConsumerStatefulWidget {
  const DriverDashboard({super.key});

  @override
  ConsumerState<DriverDashboard> createState() => _DriverDashboardState();
}

class _DriverDashboardState extends ConsumerState<DriverDashboard> {
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    Future.microtask(() {
      ref.read(parcelProvider.notifier).loadDriverParcels();
    });
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final user = authState.user;
    final parcelState = ref.watch(parcelProvider);

    return Scaffold(
      body: _getScreen(_selectedIndex, user, parcelState),
      bottomNavigationBar: BottomNavigationBar(
        type: BottomNavigationBarType.fixed,
        currentIndex: _selectedIndex,
        onTap: (index) => setState(() => _selectedIndex = index),
        selectedItemColor: const Color(0xFF0B6E3A),
        unselectedItemColor: Colors.grey,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.local_shipping), label: 'Livraisons'),
          BottomNavigationBarItem(icon: Icon(Icons.history), label: 'Historique'),
          BottomNavigationBarItem(icon: Icon(Icons.person), label: 'Profil'),
        ],
      ),
    );
  }

  Widget _getScreen(int index, User? user, ParcelState parcelState) {
    switch (index) {
      case 0:
        return _DeliveriesScreen(parcelState: parcelState, onRefresh: _loadData);
      case 1:
        return _DeliveryHistoryScreen(parcelState: parcelState, onRefresh: _loadData);
      case 2:
        return const ProfileScreen();
      default:
        return _DeliveriesScreen(parcelState: parcelState, onRefresh: _loadData);
    }
  }
}

class _DeliveriesScreen extends StatelessWidget {
  final ParcelState parcelState;
  final VoidCallback onRefresh;

  const _DeliveriesScreen({
    required this.parcelState,
    required this.onRefresh,
  });

  List<Parcel> get _activeDeliveries {
    return parcelState.parcels.where((p) => 
      p.status == ParcelStatus.confirmed ||
      p.status == ParcelStatus.pickedUp ||
      p.status == ParcelStatus.inTransit ||
      p.status == ParcelStatus.outForDelivery
    ).toList();
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      child: CustomScrollView(
        slivers: [
          const SliverAppBar(
            expandedHeight: 150,
            floating: true,
            pinned: true,
            backgroundColor: Color(0xFF0B6E3A),
            flexibleSpace: FlexibleSpaceBar(
              title: Text('Mes livraisons'),
              background: FlexibleSpaceBarBackground(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF0B6E3A), Color(0xFF168A48)],
                ),
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                _buildStats(),
                const SizedBox(height: 24),
                const Text('Livraisons en cours', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                if (parcelState.isLoading)
                  const Center(child: CircularProgressIndicator())
                else if (_activeDeliveries.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(40),
                    alignment: Alignment.center,
                    child: Column(
                      children: [
                        Icon(Icons.check_circle, size: 64, color: Colors.green.withAlpha(100)),
                        const SizedBox(height: 12),
                        Text('Aucune livraison active', style: TextStyle(color: Colors.grey.withAlpha(150))),
                      ],
                    ),
                  )
                else
                  ..._activeDeliveries.map((parcel) => _DeliveryCard(parcel: parcel, onRefresh: onRefresh)),
                const SizedBox(height: 80),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStats() {
    final activeCount = _activeDeliveries.length;
    final deliveredCount = parcelState.parcels.where((p) => p.isDelivered).length;
    
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.blue.withAlpha(25),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              children: [
                Text(
                  activeCount.toString(),
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.blue),
                ),
                const Text('En cours', style: TextStyle(fontSize: 12)),
              ],
            ),
          ),
          Container(height: 40, width: 1, color: Colors.grey.withAlpha(100)),
          Expanded(
            child: Column(
              children: [
                Text(
                  deliveredCount.toString(),
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.green),
                ),
                const Text('Livrés', style: TextStyle(fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DeliveryCard extends StatelessWidget {
  final Parcel parcel;
  final VoidCallback onRefresh;

  const _DeliveryCard({required this.parcel, required this.onRefresh});

  void _updateStatus(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => _DeliveryUpdateSheet(parcel: parcel, onRefresh: onRefresh),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: () => _updateStatus(context),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    parcel.trackingNumber,
                    style: const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'monospace'),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: parcel.status.color.withAlpha(25),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      parcel.status.label,
                      style: TextStyle(fontSize: 11, color: parcel.status.color),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Icon(Icons.person, size: 16, color: Colors.grey),
                  const SizedBox(width: 4),
                  Expanded(child: Text('Destinataire: ${parcel.receiverName}')),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  const Icon(Icons.location_on, size: 16, color: Colors.grey),
                  const SizedBox(width: 4),
                  Expanded(child: Text(parcel.receiverAddress ?? 'Adresse non précisée')),
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _updateStatus(context),
                  icon: const Icon(Icons.update),
                  label: const Text('Mettre à jour le statut'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0B6E3A),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DeliveryUpdateSheet extends StatefulWidget {
  final Parcel parcel;
  final VoidCallback onRefresh;

  const _DeliveryUpdateSheet({required this.parcel, required this.onRefresh});

  @override
  State<_DeliveryUpdateSheet> createState() => _DeliveryUpdateSheetState();
}

class _DeliveryUpdateSheetState extends State<_DeliveryUpdateSheet> {
  final ApiService _apiService = ApiService();
  bool _isLoading = false;
  String? _selectedStatus;
  final TextEditingController _notesController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _selectedStatus = widget.parcel.status.value;
  }

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _updateStatus() async {
    if (_selectedStatus == null) return;

    setState(() => _isLoading = true);
    try {
      // updateParcelStatus retourne un objet Parcel, pas un Map
      final Parcel updatedParcel = await _apiService.updateParcelStatus(
        widget.parcel.id,
        _selectedStatus!,
      );
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Statut mis à jour avec succès'), backgroundColor: Colors.green),
        );
        widget.onRefresh();
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: ${e.toString()}'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final possibleStatuses = [
      ParcelStatus.pickedUp,
      ParcelStatus.inTransit,
      ParcelStatus.arrived,
      ParcelStatus.outForDelivery,
      ParcelStatus.delivered,
    ];

    // Filtrer les statuts pour n'afficher que ceux après le statut actuel
    final currentIndex = possibleStatuses.indexWhere((s) => s.value == widget.parcel.status.value);
    final availableStatuses = currentIndex >= 0 
        ? possibleStatuses.sublist(currentIndex + 1)
        : possibleStatuses;

    return Container(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Mettre à jour le statut',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Text('Colis: ${widget.parcel.trackingNumber}'),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            value: _selectedStatus,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'Nouveau statut',
            ),
            items: availableStatuses.map((status) {
              return DropdownMenuItem(
                value: status.value,
                child: Text(status.label),
              );
            }).toList(),
            onChanged: (value) => setState(() => _selectedStatus = value),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _notesController,
            maxLines: 3,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'Notes (optionnel)',
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _isLoading ? null : _updateStatus,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0B6E3A),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
              child: _isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Mettre à jour'),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}

class _DeliveryHistoryScreen extends StatelessWidget {
  final ParcelState parcelState;
  final VoidCallback onRefresh;

  const _DeliveryHistoryScreen({
    required this.parcelState,
    required this.onRefresh,
  });

  List<Parcel> get _deliveredParcels {
    return parcelState.parcels.where((p) => p.isDelivered).toList();
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      child: CustomScrollView(
        slivers: [
          const SliverAppBar(
            title: Text('Historique des livraisons'),
            backgroundColor: Color(0xFF0B6E3A),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                if (parcelState.isLoading)
                  const Center(child: CircularProgressIndicator())
                else if (_deliveredParcels.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(40),
                    alignment: Alignment.center,
                    child: Column(
                      children: [
                        Icon(Icons.history, size: 64, color: Colors.grey.withAlpha(100)),
                        const SizedBox(height: 12),
                        Text('Aucune livraison complétée', style: TextStyle(color: Colors.grey.withAlpha(150))),
                      ],
                    ),
                  )
                else
                  ..._deliveredParcels.map((parcel) => Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: Colors.green.withAlpha(25),
                        child: const Icon(Icons.check_circle, color: Colors.green),
                      ),
                      title: Text(parcel.trackingNumber),
                      subtitle: Text('${parcel.receiverName} - Livré le ${_formatDate(parcel.deliveryDate)}'),
                      trailing: Text(parcel.deliveryDate != null ? _formatTime(parcel.deliveryDate!) : ''),
                    ),
                  )),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime? date) {
    if (date == null) return 'Date inconnue';
    return '${date.day}/${date.month}/${date.year}';
  }

  String _formatTime(DateTime date) {
    return '${date.hour}:${date.minute.toString().padLeft(2, '0')}';
  }
}

class FlexibleSpaceBarBackground extends StatelessWidget {
  final Gradient gradient;

  const FlexibleSpaceBarBackground({super.key, required this.gradient});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(gradient: gradient),
    );
  }
}